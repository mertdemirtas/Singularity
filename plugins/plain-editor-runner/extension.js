'use strict';

const path = require('node:path');
const vscode = require('vscode');
const { execFileSync } = require('node:child_process');
const { findPython, commandLine } = require('./python-command');

async function activate(context) {
  const terminals = new Map();
  let python;
  context.subscriptions.push(vscode.window.onDidCloseTerminal(closed => {
    for (const [filename, terminal] of terminals) {
      if (terminal === closed) terminals.delete(filename);
    }
  }));
  const disposable = vscode.commands.registerCommand('plainEditor.runPython', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'python' || editor.document.uri.scheme !== 'file') {
      vscode.window.showInformationMessage('Open a local Python file to run it.');
      return;
    }

    if (!await editor.document.save()) {
      vscode.window.showWarningMessage('Save the Python file before running it.');
      return;
    }

    const filename = editor.document.fileName;
    try { python ||= findPython(execFileSync); }
    catch (error) { vscode.window.showErrorMessage(error.message); return; }
    let terminal = terminals.get(filename);
    if (!terminal) {
      terminal = vscode.window.createTerminal({
        name: `Python: ${path.basename(filename)}`,
        cwd: path.dirname(filename),
        ...(process.platform === 'win32' ? {
          shellPath: path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
          shellArgs: ['-NoLogo', '-NoProfile']
        } : {})
      });
      terminals.set(filename, terminal);
    }
    terminal.show();
    terminal.sendText(commandLine(python, path.basename(filename)));
  });
  context.subscriptions.push(disposable);

}

module.exports = { activate };
