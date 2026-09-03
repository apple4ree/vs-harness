# Witch Playground

[English](README.md) · [한국어](README.ko.md)

This is a small JavaScript project that runs without installing packages. It uses no external services, credentials, or network access. Use Node.js 22 or newer.

Open this directory with **Open repository** in Witch to inspect the `src → src/services → src/domain` and `src → src/ui` relations. Test files also appear through their real import relations.

1. In Constellation, double-click a module to open its files and select an edge to inspect import evidence.
2. Drag the handle of the `src/services` card into the conversation panel.
3. If Codex CLI is signed in, ask “Explain how the greeting is produced” in Ask mode.
4. In Change mode, ask “Change Hello to Welcome and update the test expectation.”
5. Review the isolated diff. The original project is still unchanged. Approve and apply selected files to update the graph's change indicators.
6. To keep the proposal without applying it, choose **Archive without applying**.

Run the following commands from this project directory in a terminal. The same npm scripts are available through Witch Tasks after command review.

```sh
npm start
npm test
```

Open `src/main.js` and start Node from Run and debug to try a breakpoint. AI requests consume real Provider usage, but code navigation, graphs, and test execution do not require AI.
