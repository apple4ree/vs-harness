import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyzeRepository } from "../apps/desktop/src/main/services/architecture";
import { validateFrameworkGraph } from "../apps/desktop/src/shared/framework-ir";
import { validateArchitectureGraph } from "../apps/desktop/src/shared/architecture-ir";
import { buildSemanticView } from "../apps/desktop/src/renderer/src/components/architecture-view";

test("versioned framework adapters emit only explicit source-backed registrations", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "witch-framework-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "app", "api", "users"), { recursive: true });
  await fs.writeFile(
    path.join(root, "python_adapters.py"),
    [
      "raise RuntimeError('repository code must never execute during analysis')",
      "from fastapi import FastAPI",
      "from langgraph.graph import StateGraph, START, END",
      "from celery import Celery, shared_task",
      "app = FastAPI()",
      "celery_app = Celery('tasks')",
      "graph = StateGraph(dict)",
      "dynamic_path = '/dynamic'",
      "",
      "def list_items(): return []",
      "def create_item(): return {}",
      "def prepare(state): return state",
      "def finish(state): return state",
      "",
      "@app.get('/items')",
      "def get_items(): return list_items()",
      "app.add_api_route('/items', create_item, methods=['POST'])",
      "@app.get(dynamic_path)",
      "def dynamic_route(): return None",
      "app.add_api_route(dynamic_path, lambda: None)",
      "",
      "graph.add_node('prepare', prepare)",
      "graph.add_node('finish', finish)",
      "graph.add_edge(START, 'prepare')",
      "graph.add_edge('prepare', 'finish')",
      "graph.add_edge('finish', END)",
      "graph.add_edge('missing', 'finish')",
      "graph.add_node(dynamic_path, lambda state: state)",
      "",
      "@celery_app.task",
      "def settle(order): return order",
      "@shared_task",
      "def reconcile(order): return order",
      "def queue(order):",
      "    settle.delay(order)",
      "    reconcile.apply_async((order,))",
      "    celery_app.send_task(dynamic_path)",
      "    celery_app.signature(dynamic_path)",
      "",
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(root, "server.ts"),
    [
      "import express from 'express';",
      "import { Controller, Get, Post } from '@nestjs/common';",
      "const app = express();",
      "const dynamicPath = '/dynamic';",
      "export function listUsers() { return []; }",
      "export function createUser() { return {}; }",
      "app.get('/users', listUsers);",
      "app.post('/users', createUser);",
      "app.get(dynamicPath, listUsers);",
      "app.post('/dynamic', (req, res) => res.end());",
      "@Controller('accounts')",
      "export class AccountsController {",
      "  @Get()",
      "  list() { return []; }",
      "  @Post('open')",
      "  open() { return {}; }",
      "  @Get(dynamicPath)",
      "  dynamic() { return null; }",
      "  @Post(dynamicPath + '/open')",
      "  dynamicPost() { return null; }",
      "}",
      "",
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(root, "app", "api", "users", "route.ts"),
    [
      "import { NextResponse } from 'next/server';",
      "export async function GET() { return NextResponse.json([]); }",
      "export async function POST() { return NextResponse.json({}); }",
      "function hidden() { return null; }",
      "export const DELETE = makeHandler();",
      "export const PATCH = service.handler;",
      "",
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(root, "server.rs"),
    [
      "use axum::{Router, routing::{get, post}};",
      "use tokio::{task, sync::mpsc};",
      "async fn list_users() {}",
      "async fn create_user() {}",
      "async fn worker() {}",
      "fn dynamic_handler() {}",
      "async fn run() {",
      "    let app = Router::new()",
      "        .route(\"/users\", get(list_users))",
      "        .route(\"/users\", post(create_user));",
      "    app.route(dynamic_path, get(dynamic_handler));",
      "    app.route(\"/dynamic\", get(service.handler));",
      "    tokio::spawn(worker());",
      "    tokio::spawn(async move {});",
      "    task::spawn(factory());",
      "    let (tx, mut rx) = mpsc::channel::<i32>(8);",
      "    tx.send(1).await;",
      "    rx.recv().await;",
      "}",
      "",
    ].join("\n"),
  );

  const graph = await analyzeRepository(root);
  const frameworks = graph.frameworks!;
  assert(frameworks);
  assert.equal(frameworks.validation.valid, true);
  assert.equal(frameworks.contract, "witch.framework/v1");
  const byFramework = new Map(
    frameworks.coverage.map((item) => [item.framework, item]),
  );
  for (const framework of [
    "fastapi",
    "langgraph",
    "celery",
    "express",
    "nestjs",
    "nextjs",
    "axum",
    "tokio",
  ] as const) {
    assert.equal(byFramework.get(framework)?.detectedFiles, 1, framework);
    assert(
      (byFramework.get(framework)?.candidateCount || 0) >= 2,
      `${framework} should emit at least two positive source-backed fixtures`,
    );
  }
  for (const framework of [
    "fastapi",
    "langgraph",
    "celery",
    "express",
    "nestjs",
    "nextjs",
    "axum",
    "tokio",
  ] as const)
    assert(
      (byFramework.get(framework)?.excludedCount || 0) >= 2,
      `${framework} should preserve at least two negative fixtures as exclusions`,
    );
  assert(
    frameworks.candidates.every(
      (candidate) =>
        candidate.ruleId &&
        candidate.adapterVersion &&
        candidate.evidence.length > 0,
    ),
  );
  assert.equal(
    frameworks.candidates.some((candidate) =>
      candidate.evidence[0].excerpt?.includes("dynamicPath"),
    ),
    false,
  );
  assert.equal(
    frameworks.candidates.some((candidate) =>
      candidate.evidence[0].excerpt?.includes("async move"),
    ),
    false,
  );
  const frameworkRelations = graph.behavior!.relations.filter(
    (relation) => relation.provenance.framework,
  );
  assert.equal(frameworkRelations.length, frameworks.candidates.length);
  assert(
    frameworkRelations.every(
      (relation) =>
        relation.provenance.ruleId && relation.provenance.candidateId,
    ),
  );
  const frameworkView = buildSemanticView(
    graph,
    false,
    "",
    new Set(),
    "frameworks",
    {},
    "complete",
  );
  assert.equal(frameworkView.totalEdges, frameworks.candidates.length);
  assert(
    frameworkView.edges.every(
      (edge) => edge.data?.behavior === true && edge.data?.framework === true,
    ),
  );
  assert.equal(await fs.stat(root).then(() => true), true);
});

test("framework validation fails closed on missing rules, stale evidence, and endpoints", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "witch-framework-validation-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(
    path.join(root, "api.py"),
    "from fastapi import FastAPI\napp = FastAPI()\n@app.get('/health')\ndef health(): return {'ok': True}\n",
  );
  const graph = await analyzeRepository(root);
  const frameworks = structuredClone(graph.frameworks!);
  assert(frameworks.candidates.length > 0);
  frameworks.candidates[0].ruleId = "";
  frameworks.candidates[0].to = "semantic:missing";
  frameworks.candidates[0].evidence[0].hash = "0".repeat(64);
  const receipt = validateFrameworkGraph(
    frameworks,
    graph.semantic,
    graph.nodes,
  );
  assert.equal(receipt.valid, false);
  assert(
    receipt.diagnostics.some(
      (item) => item.code === "FRAMEWORK_RULE_PROVENANCE_MISSING",
    ),
  );
  assert(
    receipt.diagnostics.some(
      (item) => item.code === "FRAMEWORK_ENDPOINT_MISSING",
    ),
  );
  assert(
    receipt.diagnostics.some(
      (item) => item.code === "FRAMEWORK_EVIDENCE_HASH_MISMATCH",
    ),
  );
  const architecture = structuredClone(graph);
  const relationId = architecture.frameworks!.candidates[0].relationId;
  const relation = architecture.behavior!.relations.find(
    (item) => item.id === relationId,
  )!;
  relation.provenance.ruleId = "different.rule.v1";
  const architectureReceipt = validateArchitectureGraph(architecture);
  assert.equal(architectureReceipt.valid, false);
  assert(
    architectureReceipt.diagnostics.some(
      (item) => item.code === "IR_FRAMEWORK_RELATION_PROVENANCE_MISMATCH",
    ),
  );
});
