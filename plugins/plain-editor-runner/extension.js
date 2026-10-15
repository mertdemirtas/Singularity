'use strict';

const path = require('node:path');
const vscode = require('vscode');

function shellQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function activate(context) {
  const terminals = new Map();
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
    let terminal = terminals.get(filename);
    if (!terminal) {
      terminal = vscode.window.createTerminal({
        name: `Python: ${path.basename(filename)}`,
        cwd: path.dirname(filename)
      });
      terminals.set(filename, terminal);
    }
    terminal.show();
    terminal.sendText(`python3 ${shellQuote(path.basename(filename))}`);
  });
  context.subscriptions.push(disposable);

}

module.exports = { activate };
