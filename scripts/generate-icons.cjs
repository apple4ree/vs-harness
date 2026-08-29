// Deterministic exports of the repo-native Witch moon SVG. No network or AI call.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

app.disableHardwareAcceleration();
app
  .whenReady()
  .then(async () => {
    const directory = path.resolve(__dirname, "../build");
    const svg = await fs.readFile(path.join(directory, "icon.svg"), "utf8");
    const window = new BrowserWindow({
      show: false,
      width: 1024,
      height: 1024,
      useContentSize: true,
      transparent: true,
      frame: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        offscreen: true,
      },
    });
    try {
      await window.loadURL(
        "data:text/html;charset=utf-8," +
          encodeURIComponent(
            `<style>html,body{margin:0;width:1024px;height:1024px;background:transparent}svg{display:block}</style>${svg}`,
          ),
      );
      await window.webContents.executeJavaScript(
        "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
      );
      const capture = await window.webContents.capturePage();
      const pngs = new Map(
        [16, 24, 32, 48, 64, 128, 256, 512, 1024].map((size) => [
          size,
          capture
            .resize({ width: size, height: size, quality: "best" })
            .toPNG(),
        ]),
      );
      await fs.writeFile(path.join(directory, "icon.png"), pngs.get(1024));
      const icoSizes = [16, 24, 32, 48, 64, 128, 256];
      const icoHeader = Buffer.alloc(6 + icoSizes.length * 16);
      icoHeader.writeUInt16LE(1, 2);
      icoHeader.writeUInt16LE(icoSizes.length, 4);
      let offset = icoHeader.length;
      icoSizes.forEach((size, index) => {
        const position = 6 + index * 16,
          bytes = pngs.get(size);
        icoHeader[position] = icoHeader[position + 1] = size === 256 ? 0 : size;
        icoHeader.writeUInt16LE(1, position + 4);
        icoHeader.writeUInt16LE(32, position + 6);
        icoHeader.writeUInt32LE(bytes.length, position + 8);
        icoHeader.writeUInt32LE(offset, position + 12);
        offset += bytes.length;
      });
      await fs.writeFile(
        path.join(directory, "icon.ico"),
        Buffer.concat([icoHeader, ...icoSizes.map((size) => pngs.get(size))]),
      );
      const icnsTypes = [
        [16, "icp4"],
        [32, "icp5"],
        [64, "icp6"],
        [128, "ic07"],
        [256, "ic08"],
        [512, "ic09"],
        [1024, "ic10"],
      ];
      const chunks = icnsTypes.map(([size, type]) => {
        const bytes = pngs.get(size),
          header = Buffer.alloc(8);
        header.write(type, 0, 4, "ascii");
        header.writeUInt32BE(bytes.length + 8, 4);
        return Buffer.concat([header, bytes]);
      });
      const header = Buffer.alloc(8);
      header.write("icns", 0, 4, "ascii");
      header.writeUInt32BE(
        8 + chunks.reduce((size, chunk) => size + chunk.length, 0),
        4,
      );
      await fs.writeFile(
        path.join(directory, "icon.icns"),
        Buffer.concat([header, ...chunks]),
      );
      console.log(
        "Generated Witch PNG, Windows ICO, and macOS ICNS from build/icon.svg",
      );
    } finally {
      window.destroy();
      app.quit();
    }
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
