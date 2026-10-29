'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { commandOwners, toolbarOwner, sections } = require('../../extensions/plain-editor-ui/toolbar-sections.cjs');

test('toolbar sections use actual extension ownership for commands and submenus', () => {
  const owners = commandOwners([
    { metadata: { model: { id: 'example.one' } }, contributes: { commands: [{ command: 'one.run' }], submenus: [{ id: 'one.menu' }], menus: { 'editor/title': [{ command: 'runtime.command' }] } } },
    { metadata: { model: { id: 'example.two' } }, contributes: { commands: [{ command: 'two.run' }] } }
  ]);
  assert.equal(toolbarOwner({ id: 'native-item', action: { command: 'one.run' } }, owners), 'example.one');
  assert.equal(toolbarOwner({ id: 'wrapped', menuNode: { id: 'two.run' } }, owners), 'example.two');
  assert.equal(toolbarOwner({ id: 'submenu', menuNode: { id: 'one.menu' } }, owners), 'example.one');
  assert.equal(owners.get('runtime.command'), 'example.one');
  assert.equal(toolbarOwner({ id: 'plain-editor.new-file', action: { command: 'one.run' } }, owners), 'editor');
  assert.equal(toolbarOwner({ id: 'unknown-command' }, owners), 'editor');
});

test('each extension stays together without changing item order or producing empty sections', () => {
  const entries = [
    { id: 'a1', owner: 'A', node: 'button' }, { id: 'b', owner: 'B', node: 'button' },
    { id: 'a2', owner: 'A', node: 'button' }, { id: 'hidden', owner: 'C', node: null }
  ];
  assert.deepEqual(sections(entries).map(([owner, items]) => [owner, items.map(item => item.id)]), [['A', ['a1', 'a2']], ['B', ['b']]]);
  assert.deepEqual(sections([]), []);
});

test('narrow toolbars move whole extension sections to More and keep New File visible', () => {
  const { fitToolbar } = require('../../extensions/plain-editor-ui/toolbar-sections.cjs');
  const entries = [
    { id: 'A.run', owner: 'A', width: 24, canOverflow: true },
    { id: 'A.debug', owner: 'A', width: 24, canOverflow: true },
    { id: 'B.run', owner: 'B', width: 24, canOverflow: true },
    { id: 'plain-editor.new-file', owner: 'editor', width: 24, canOverflow: true }
  ];
  assert.equal(fitToolbar(entries, 150).size, 0);
  const hidden = fitToolbar(entries, 85);
  assert(hidden.has('A.run') && hidden.has('A.debug'));
  assert(!hidden.has('plain-editor.new-file'));
  assert.deepEqual([...fitToolbar(entries, 48)], ['A.run', 'A.debug', 'B.run']);
  assert.equal(fitToolbar(entries, 150).size, 0, 'Growing the pane restores collapsed actions');
});

test('overflow retains non-menu custom actions and collapses secondary editor commands as needed', () => {
  const { fitToolbar } = require('../../extensions/plain-editor-ui/toolbar-sections.cjs');
  const entries = [
    { id: 'custom', owner: 'extension', width: 24, canOverflow: false },
    { id: 'plain-editor.new-file', owner: 'editor', width: 24, canOverflow: true },
    { id: 'plain-editor.split-right', owner: 'editor', width: 24, canOverflow: true },
    { id: 'plain-editor.export-pdf', owner: 'editor', width: 24, canOverflow: true }
  ];
  const hidden = fitToolbar(entries, 90);
  assert(hidden.has('plain-editor.split-right'));
  assert(!hidden.has('custom') && !hidden.has('plain-editor.new-file'));
});
