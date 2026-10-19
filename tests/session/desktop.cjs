"use strict";
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), net = require("node:net"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process"), { pathToFileURL } = require("node:url"), puppeteer = require("puppeteer");
const root = path.resolve(__dirname, "../.."), temp = fs.mkdtempSync(path.join(os.tmpdir(), "singularity-session-health-"));
const config = path.join(temp, "config"), project = path.join(temp, "project");
fs.mkdirSync(config);
fs.mkdirSync(project);
const files = ["first.txt", "second.txt"].map((name) => {
  const file = path.join(project, name);
  fs.writeFileSync(file, "original\n");
  return file;
});
fs.writeFileSync(path.join(config, "settings.json"), JSON.stringify({ "files.autoSave": "off", "telemetry.telemetryLevel": "off", "git.autofetch": false, "security.workspace.trust.trustedFolders": [pathToFileURL(project).href] }));
fs.writeFileSync(path.join(config, "recentworkspace.json"), JSON.stringify({ recentRoots: [pathToFileURL(project).href] }));
const fixture = path.join(config, "deployedPlugins", "singularity.save-fixture@0.0.1", "extension");
fs.mkdirSync(fixture, { recursive: true });
fs.writeFileSync(path.join(fixture, "../extension.vsixmanifest"), "<PackageManifest/>");
fs.writeFileSync(path.join(fixture, "package.json"), JSON.stringify({ name: "save-fixture", publisher: "singularity", version: "0.0.1", engines: { vscode: "^1.85.0" }, main: "extension.cjs", activationEvents: ["*"] }));
fs.writeFileSync(path.join(fixture, "extension.cjs"), `exports.activate=()=>{const v=require('vscode');let stall=false;v.commands.registerCommand('singularity.fixture.stall',()=>{stall=true;});v.workspace.onWillSaveTextDocument(e=>{if(stall)e.waitUntil(new Promise(()=>{}));});};`);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let child, browser, page, backendPid;
const log = fs.createWriteStream(path.join(temp, "desktop.log"));
async function until(check, label, timeout = 12e3) {
  const end = Date.now() + timeout;
  while (!await check()) {
    if (Date.now() > end) throw Error("Timed out: " + label);
    await pause(100);
  }
}
(async () => {
  const socket = net.createServer();
  await new Promise((r) => socket.listen(0, "127.0.0.1", r));
  const port = socket.address().port;
  await new Promise((r) => socket.close(r));
  child = spawn(process.env.HEALTH_EXECUTABLE || process.execPath, [...process.env.HEALTH_EXECUTABLE ? [] : ["scripts/launch-desktop.cjs"], "--user-data-dir=" + path.join(temp, "profile"), "--remote-debugging-port=" + port, "--ozone-platform=x11", "--disable-gpu"], { cwd: root, env: { ...process.env, THEIA_CONFIG_DIR: config }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  await until(async () => {
    try {
      browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:" + port, defaultViewport: null, protocolTimeout: 2e4 });
      return true;
    } catch {
      return false;
    }
  }, "desktop launch", 6e4);
  page = await (await browser.waitForTarget((t) => t.type() === "page")).page();
  page.on("pageerror", (e) => log.write("PAGEERROR: " + e.stack + "\n"));
  await page.waitForSelector("body.plain-session-ready #plain-header", { timeout: 6e4 });
  await page.evaluate(async (files2) => {
    window.healthValues = [...theia.container._bindingDictionary._map.values()].flat().map((b) => b.cache);
    window.healthShell = healthValues.find((v) => Object.keys(v || {}).includes("mainPanel"));
    window.healthCommands = healthValues.find((v) => Object.keys(v || {}).includes("_commands"));
    window.healthConnection = healthValues.find((v) => Object.keys(v || {}).includes("_socket") && Object.keys(v || {}).includes("currentChannel"));
    for (const file of files2) await healthCommands.executeCommand("vscode.open", file);
    window.healthWidget = healthShell.mainPanel.currentTitle.owner;
    window.healthChannel = healthConnection?.currentChannel;
  }, files.map((file) => pathToFileURL(file).href));
  const system = await browser.target().createCDPSession();
  const { processInfo } = await system.send("SystemInfo.getProcessInfo");
  const mainPid = processInfo.find((p) => p.type === "browser").id;
  if (process.platform === "linux") {
    const children = fs.readFileSync("/proc/" + mainPid + "/task/" + mainPid + "/children", "utf8").trim().split(/\s+/);
    backendPid = children.find((pid) => {
      try {
        return fs.readFileSync("/proc/" + pid + "/cmdline", "utf8").includes("backend-process.cjs");
      } catch {
        return false;
      }
    });
  }
  const mode = process.env.SESSION_CASE || "reconnect";
  console.log("Mode:", mode, "Diagnostics:", temp);
  if (mode === "savehook") {
    await page.evaluate(() => healthCommands.executeCommand("singularity.fixture.stall"));
    await page.evaluate(() => {
      healthWidget.editor.getControl().setValue("save survives hung extension\n");
      healthWidget.editor.getControl().focus();
      healthWidget.saveable.save().then(() => console.info("HEALTH SAVE FINISHED"), (e) => console.error("HEALTH SAVE FAILED", e));
    });
    await until(() => fs.readFileSync(files[1], "utf8") === "save survives hung extension\n", "save despite stalled willSave participant", 15e3);
    await page.evaluate(() => {
      healthWidget.editor.getControl().setValue('saved while closing with a hung extension\n');
      window.plainEditorDesktop.requestClose();
    });
    await page.waitForSelector('.dialogOverlay', { visible: true });
    const buttons = await page.$$('.dialogOverlay button');
    let saved = false;
    for (const button of buttons) {
      if (/^Save(?: All)?$/.test(await button.evaluate(node => node.textContent.trim()))) { await button.click(); saved = true; break; }
    }
    assert(saved, 'The close review must offer Save');
    await until(() => fs.readFileSync(files[1], 'utf8') === 'saved while closing with a hung extension\n', 'save from close review');
    await until(() => child.exitCode !== null, 'close after Save');
  } else if (mode === "drag") {
    const index = await page.evaluate(() => {
      const bar = healthShell.getTabBarFor(healthWidget);
      const tab = bar.contentNode.children[0], rect = tab.getBoundingClientRect();
      tab.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, buttons: 1, clientX: rect.left + 20, clientY: rect.top + 15, pointerId: 1 }));
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("focus"));
      return { held: !!bar._dragData };
    });
    console.log("Lost pointer release after blur:", index);
    await page.click(".lm-TabBar.theia-app-main .lm-TabBar-tab:last-child .lm-TabBar-tabLabel");
    assert(await page.evaluate(() => healthShell.mainPanel.currentTitle.owner === healthWidget), "First click after wake must switch tabs");
  } else if (mode === "soak") {
    const length = Number(process.env.SESSION_SOAK_MS || 6e5), metrics = [], client = await page.createCDPSession();
    await client.send("Performance.enable");
    const bulk = path.join(project, "bulk");
    fs.mkdirSync(bulk);
    for (let i = 0; i < 3e3; i++) fs.writeFileSync(path.join(bulk, "file-" + i + ".txt"), "project file " + i + "\n");
    const csv = path.join(project, "large.csv");
    fs.writeFileSync(csv, ("value,".repeat(100) + "123\n").repeat(2e4));
    const start = Date.now();
    let cycle = 0, lastSample = 0;
    while (Date.now() - start < length) {
      const text = "soak edit " + cycle + "\n";
      await page.evaluate(async (text2) => {
        await healthShell.activateWidget(healthWidget.id);
        healthWidget.editor.getControl().setValue(text2);
        healthWidget.editor.getControl().focus();
      }, text);
      await pause(100);
      await page.keyboard.down("Control");
      await page.keyboard.press("s");
      await page.keyboard.up("Control");
      await until(() => fs.readFileSync(files[1], "utf8") === text, "Ctrl+S during soak", 15e3);
      const file = cycle % 12 === 0 ? csv : path.join(bulk, "file-" + cycle % 3e3 + ".txt");
      await page.evaluate(async (file2) => {
        await healthCommands.executeCommand("vscode.open", file2);
        const widget = healthShell.mainPanel.currentTitle.owner;
        if (widget !== healthWidget) await healthShell.closeWidget(widget.id, { save: false });
        await healthShell.activateWidget(healthWidget.id);
      }, pathToFileURL(file).href);
      if (cycle % 10 === 0) {
        await page.evaluate(() => healthConnection.socket.disconnect());
        await pause(200);
        await page.evaluate(() => healthConnection.socket.connect());
        await page.waitForFunction(() => healthConnection.socket.connected);
        await pause(300);
        assert(await page.evaluate(() => healthConnection.currentChannel === healthChannel), "Soak must preserve RPC state");
      }
      if (Date.now() - lastSample > 3e4) {
        await client.send("HeapProfiler.collectGarbage");
        const values = Object.fromEntries((await client.send("Performance.getMetrics")).metrics.map((v) => [v.name, v.value]));
        const dom = await client.send("Memory.getDOMCounters");
        const backend = backendPid ? { backendRssMiB: Number(fs.readFileSync("/proc/" + backendPid + "/statm", "utf8").split(" ")[1]) * 4096 / 1024 / 1024, backendFDs: fs.readdirSync("/proc/" + backendPid + "/fd").length } : {};
        const sample = { seconds: Math.round((Date.now() - start) / 1e3), cycle, heap: values.JSHeapUsedSize, ...dom, ...backend };
        metrics.push(sample);
        lastSample = Date.now();
        fs.writeFileSync(path.join(temp, "memory.json"), JSON.stringify(metrics, null, 2));
        console.log("MEMORY", JSON.stringify(sample));
      }
      cycle++;
      await pause(250);
    }
    // Theia deliberately caches closed text models for three minutes. Compare
    // steady-state samples after that cache has warmed up, not startup vs cache.
    const settled = metrics.filter((sample) => sample.seconds >= 180);
    assert(settled.length >= 2, "Need steady-state memory samples");
    const first = settled[0], last = settled.at(-1);
    assert(last.heap - first.heap < 96 * 1024 * 1024, "Retained renderer heap must stay bounded");
    assert(last.jsEventListeners - first.jsEventListeners < 8e3, "Disposed editors must not accumulate unbounded listeners");
    if (backendPid) {
      assert(last.backendRssMiB - first.backendRssMiB < 128, "Backend memory must stay bounded");
      assert(last.backendFDs - first.backendFDs < 100, "Backend must release file handles");
    }
    console.log("SOAK RESULT", JSON.stringify({ cycles: cycle, minutes: length / 6e4, heapGrowthMiB: (last.heap - first.heap) / 1024 / 1024 }));
  } else {
    assert(await page.evaluate(() => !!healthConnection), "Connection source must be present");
    for (let cycle = 0; cycle < 12; cycle++) {
      await page.evaluate(() => {
        healthWidget.editor.getControl().setValue("unsaved across disconnect\n");
        healthConnection.socket.disconnect();
      });
      await pause(200);
      await page.evaluate(() => healthConnection.socket.connect());
      await page.waitForFunction(() => healthConnection.socket.connected, { timeout: 15e3 });
      await pause(500);
      const text = "saved after reconnect " + cycle + "\n";
      await page.evaluate((text2) => {
        healthWidget.editor.getControl().setValue(text2);
        healthWidget.editor.getControl().focus();
        healthWidget.saveable.save().then(() => console.info("HEALTH SAVE FINISHED"), (e) => console.error("HEALTH SAVE FAILED", e));
      }, text);
      await until(() => fs.readFileSync(files[1], "utf8") === text, "save after reconnect " + cycle, 15e3);
      assert(await page.evaluate(() => healthConnection.currentChannel === healthChannel), "Wake-up must retain the same RPC session");
      console.log("Reconnect/save cycle:", cycle + 1);
    }
  }
  if (child.exitCode === null) await page.evaluate(async () => {
    for (const widget of healthShell.mainPanel.widgets()) if (widget.saveable?.dirty) await widget.saveable.revert();
    window.plainEditorDesktop.requestClose();
  });
  await until(() => child.exitCode !== null, "normal close after session fault", 15e3);
  if (backendPid) await until(() => {
    try {
      return /^\d+ \(.+\) Z /.test(fs.readFileSync("/proc/" + backendPid + "/stat", "utf8"));
    } catch {
      return true;
    }
  }, "backend exits with desktop");
  console.log("PASS:", mode, "and normal close");
})().catch((e) => {
  console.error(e.stack);
  process.exitCode = 1;
}).finally(async () => {
  await browser?.disconnect();
  if (child?.exitCode === null) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
    }
  }
  await pause(700);
  if (child?.exitCode === null) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
    }
  }
  child?.stdout.destroy();
  child?.stderr.destroy();
  log.end();
  console.log("Diagnostics:", temp);
});
