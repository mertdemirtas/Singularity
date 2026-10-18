'use strict';

const monaco = require('@theia/monaco-editor-core');
const {PreferenceService} = require('@theia/core/lib/common/preferences/preference-service');
const {parseMergeBlocks,choiceText} = require('./git-merge-blocks.cjs');
const {locateConflictSources,moveConflictRanges} = require('./git-merge-choices.cjs');
const {createGitSplitter} = require('./git-splitter');
let sequence = 0;

class MergeResolutionEditor {
  constructor(widget, details) {
    this.widget = widget; this.details = details; this.disposables = []; this.active = 0;
    this.preferences = widget.container.get(PreferenceService);
    this.root = document.createElement('div'); this.root.className = 'plain-git-merge-editor';
    this.root.innerHTML = `<div class="plain-git-merge-guide">Choose what to keep in each conflict. Review or edit Result, then Save and stage. You can change your choices before saving.</div><div class="plain-git-merge-toolbar">
      <button data-merge-action="files">Show files</button><button data-merge-action="previous" title="Previous conflict (Shift+F7)">Previous</button><button data-merge-action="next" title="Next conflict (F7)">Next</button>
      <select data-merge-conflict aria-label="Choose a conflict to review"></select>
      <span data-merge-counter role="status" aria-live="polite"></span>
      <button data-merge-action="undo" title="Undo the last result edit">Undo</button><button data-merge-action="redo" title="Redo the last result edit">Redo</button><button data-merge-action="reset" title="Restore the original conflicted merge">Reset choices</button>
      <details class="plain-merge-view-options"><summary>View</summary><div><label>Layout <select data-merge-layout aria-label="Merge layout"><option value="columns">Columns</option><option value="rows">Rows</option></select></label>
      <label><input type="checkbox" data-merge-wrap>Wrap lines</label><button data-merge-action="expand" aria-pressed="false">Hide Git controls</button></div></details><button data-git-action="fullscreen">Full screen</button>
    </div>
    <div class="plain-git-merge-body">
      <section class="plain-git-merge-comparison" aria-label="Compare current and incoming files">
        <div class="plain-git-merge-source-headings"><div><strong title="The existing version before applying these changes">Current · Existing version</strong><small data-merge-current-lines></small><div class="plain-git-merge-source-actions"><button data-merge-action="selection-current">Use selected lines</button><button data-merge-action="whole-current" title="Replace the entire result, including other choices, with the current file">Use this file</button></div></div><div><strong title="The version being applied by this Git operation">Incoming · Other version</strong><small data-merge-incoming-lines></small><div class="plain-git-merge-source-actions"><button data-merge-action="selection-incoming">Use selected lines</button><button data-merge-action="whole-incoming" title="Replace the entire result, including other choices, with the incoming file">Use this file</button></div></div></div>
        <div class="plain-git-merge-diff" data-merge-comparison></div>
        <div class="plain-git-merge-diff-navigation"><button data-merge-action="previous-diff">Previous difference</button><button data-merge-action="next-diff">Next difference</button><small>Click the icon beside a line number to select a change. Use this file replaces the entire result.</small></div>
      </section><div class="plain-git-merge-splitter" aria-label="Resize comparison and result"></div>
      <section class="plain-git-merge-result-pane" aria-label="Editable merge result">
        <div class="plain-git-merge-result-heading"><strong>Result · Editable</strong><small data-merge-result-lines></small><label>Line <input type="number" min="1" data-merge-line aria-label="Go to result line" title="Go to line (Ctrl+G / Command+G)"></label><button data-merge-action="line">Go</button></div>
        <div class="plain-git-merge-block-actions" aria-label="Apply a choice to the active conflict only"><span data-merge-block-label>Active conflict</span><button data-merge-action="current">Use current</button><button data-merge-action="incoming">Use incoming</button><button data-merge-action="both">Use both</button></div>
        <div class="plain-git-merge-result-code" data-git-result></div>
      </section>
    </div>
    <div class="plain-git-merge-footer"><label><input type="checkbox" data-merge-delete>Delete this file</label><span data-merge-help role="status" aria-live="polite"></span><button data-git-save-resolution title="Write Result to disk and mark this file resolved. Use Finish merge afterwards to create the merge commit.">Save and stage</button><button data-merge-action="discard" title="Discard unsaved resolution edits">Discard</button></div>`;
    widget.review.append(this.root);
    this.body = this.root.querySelector('.plain-git-merge-body');
    this.counter = this.root.querySelector('[data-merge-counter]'); this.help = this.root.querySelector('[data-merge-help]');
    this.deleted = this.root.querySelector('[data-merge-delete]'); this.deleted.checked = details.deleted;
    this.deleted.parentElement.hidden=!details.current.deleted&&!details.incoming.deleted;
    this.conflictSelect=this.root.querySelector('[data-merge-conflict]');
    this.layoutSelect = this.root.querySelector('[data-merge-layout]'); this.layoutSelect.value = widget.mergeLayout || 'columns';
    this.viewOptions=this.root.querySelector('.plain-merge-view-options');
    this.lineInput = this.root.querySelector('[data-merge-line]'); this.saveButton = this.root.querySelector('[data-git-save-resolution]');
    const file = decodeURIComponent(details.uri.split('/').pop());
    const extension = /\.[^.]+$/.exec(file)?.[0].toLowerCase();
    const language = monaco.languages.getLanguages().find(item=>item.filenames?.includes(file) || item.extensions?.includes(extension))?.id || 'plaintext';
    const id = ++sequence;
    const makeModel = (name,text) => monaco.editor.createModel(text,language,monaco.Uri.parse(`singularity-merge:/${id}/${name}/${encodeURIComponent(file)}`));
    try {
    this.currentModel = makeModel('current',details.current.text); this.incomingModel = makeModel('incoming',details.incoming.text); this.resultModel = makeModel('result',details.result);
    const options = {...this.fontOptions(),padding:{top:4,bottom:4},minimap:{enabled:false},scrollBeyondLastLine:false,wordWrap:'off',lineNumbers:'on',glyphMargin:true,automaticLayout:false,contextmenu:true};
    this.diffEditor = monaco.editor.createDiffEditor(this.root.querySelector('[data-merge-comparison]'), {
      ...options,readOnly:true,originalEditable:false,renderSideBySide:true,renderSideBySideInlineBreakpoint:0,
      useInlineViewWhenSpaceIsLimited:false,enableSplitViewResizing:true,ignoreTrimWhitespace:false,maxComputationTime:2000,hideUnchangedRegions:{enabled:false}
    });
    this.diffEditor.setModel({original:this.currentModel,modified:this.incomingModel});
    this.currentEditor = this.diffEditor.getOriginalEditor(); this.incomingEditor = this.diffEditor.getModifiedEditor();
    this.currentEditor.updateOptions({ariaLabel:'Current file, read only'}); this.incomingEditor.updateOptions({ariaLabel:'Incoming file, read only'});
    this.resultEditor = monaco.editor.create(this.root.querySelector('[data-git-result]'), {...options,model:this.resultModel,readOnly:details.deleted,ariaLabel:'Merge result'});
    this.initialResult=this.resultModel.getValue();this.states=new Map();
    const sources=[locateConflictSources(this.initialResult,this.currentModel.getValue(),'current'),locateConflictSources(this.initialResult,this.incomingModel.getValue(),'incoming')];
    this.conflicts=parseMergeBlocks(this.initialResult).blocks.map((block,index)=>({...block,sources:[sources[0][index],sources[1][index]]}));
    this.setRanges(this.conflicts.map(({start,end})=>({start,end})));this.rememberState();
    for (const [version,model] of [['current',this.currentModel],['incoming',this.incomingModel]]) {
      this.root.querySelector(`[data-merge-${version}-lines]`).textContent = details[version].deleted ? 'Deleted' : `${model.getLineCount()} lines`;
      for (const button of this.root.querySelectorAll(`[data-merge-action="whole-${version}"]`)) {
        if (details[version].deleted) {button.textContent='Delete file';button.title=`Use the ${version} version, which deletes this file`;}
      }
    }
    this.decorations = this.resultEditor.createDecorationsCollection();
    this.sourceDecorations = [this.currentEditor.createDecorationsCollection(),this.incomingEditor.createDecorationsCollection()];
    this.changeDecorations = [this.currentEditor.createDecorationsCollection(),this.incomingEditor.createDecorationsCollection()];
    this.disposables.push(this.diffEditor.onDidUpdateDiff(()=>this.updateChangeButtons()));
    for (const [index,editor] of [this.currentEditor,this.incomingEditor].entries()) {
      this.disposables.push(editor.onMouseDown(event=> {
        if(event.target.type!==monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN || !event.target.position)return;
        this.selectChange(index,event.target.position.lineNumber);
      }),editor.addAction({id:'singularity.selectMergeChange',label:'Select changed lines',contextMenuGroupId:'navigation',run:()=>this.selectChange(index,editor.getPosition().lineNumber)}));
    }
    this.disposables.push(this.resultModel.onDidChangeContent(event=> {
      const state=this.states.get(this.resultModel.getAlternativeVersionId());
      if((event.isUndoing||event.isRedoing)&&state)this.restoreState(state);
      widget.setResolutionDirty(true); clearTimeout(this.timer); this.timer = setTimeout(()=>this.update(),120);
    }), this.resultEditor.onDidChangeCursorPosition(()=>this.updateActiveFromCursor()), this.currentEditor.onDidChangeCursorSelection(()=>this.sourceSelectionChanged(0)), this.incomingEditor.onDidChangeCursorSelection(()=>this.sourceSelectionChanged(1)));
    this.disposables.push(this.preferences.onPreferencesChanged(changes=> {
      if (Object.keys(changes).some(key=>/^editor\.(font|lineHeight|tabSize|insertSpaces)/.test(key))) {
        this.diffEditor.updateOptions(this.fontOptions()); this.resultEditor.updateOptions(this.fontOptions()); this.updateModelOptions(); this.layout();
      }
    }));
    this.root.addEventListener('click',event=> {
      if(!this.viewOptions.contains(event.target))this.viewOptions.open=false;
      const button = event.target.closest('button'); if (!button || button.disabled || this.saving || widget.busy) return;
      if (button === this.saveButton) { this.save(); return; }
      const action = button.dataset.mergeAction;
      if (['current','incoming','both'].includes(action)) this.choose(action);
      else if (action === 'next' || action === 'previous') this.navigate(action === 'next' ? 1 : -1);
      else if (action === 'next-diff' || action === 'previous-diff') this.diffEditor.goToDiff(action === 'next-diff' ? 'next' : 'previous');
      else if (action === 'selection-current' || action === 'selection-incoming') {
        const editor = action === 'selection-current' ? this.currentEditor : this.incomingEditor;
        this.choose('selection',this.selectedText(editor===this.currentEditor?0:1),undefined,editor===this.currentEditor?'current':'incoming');
      } else if (action === 'whole-current' || action === 'whole-incoming') this.useWhole(action === 'whole-current' ? details.current : details.incoming);
      else if(action==='undo'||action==='redo')this.undoRedo(action);
      else if(action==='reset')widget.perform(async()=>this.resetChoices(),widget.confirmation('resetMergeChoices',{file}));
      else if (action === 'expand') {
        const expanded=widget.node.classList.toggle('plain-git-expanded-merge');button.setAttribute('aria-pressed',String(expanded));
        button.textContent=expanded?'Show Git controls':'Hide Git controls';this.viewOptions.open=false;this.layout();
      } else if (action === 'files') {
        const content = widget.node.querySelector('.plain-git-content'); content.classList.toggle('plain-git-show-conflict-files');
        button.textContent = content.classList.contains('plain-git-show-conflict-files') ? 'Hide files' : 'Show files';
      } else if (action === 'line') this.goToLine();
      else if (action === 'discard') widget.perform(async()=> {widget.setResolutionDirty(false);widget.editingConflict=false;widget.selectedResource=undefined;widget.viewKey=undefined;},widget.confirmation('discardResolution',{file}));
    });
    this.deleted.addEventListener('change',()=> { widget.setResolutionDirty(true);this.resultEditor.updateOptions({readOnly:this.deleted.checked});this.updateControls(); });
    this.root.querySelector('[data-merge-wrap]').addEventListener('change',event=> {const wordWrap=event.target.checked?'on':'off';this.diffEditor.updateOptions({wordWrap});this.resultEditor.updateOptions({wordWrap});});
    this.layoutSelect.addEventListener('change',()=> {widget.mergeLayout=this.layoutSelect.value;this.layout();});
    this.conflictSelect.addEventListener('change',()=> {this.active=Number(this.conflictSelect.value);this.reveal();});
    this.lineInput.addEventListener('keydown',event=> {if(event.key==='Enter'){event.preventDefault();this.goToLine();}});
    this.shortcuts = event => {
      if(event.key==='Escape'&&this.viewOptions.open){this.viewOptions.open=false;event.preventDefault();event.stopPropagation();return;}
      if((event.ctrlKey||event.metaKey)&&['z','y'].includes(event.key.toLowerCase())&&event.target!==this.lineInput) {
        event.preventDefault();event.stopPropagation();this.undoRedo(event.key.toLowerCase()==='y'||event.shiftKey?'redo':'undo');return;
      }
      if ((event.ctrlKey || event.metaKey) && ['s','g'].includes(event.key.toLowerCase())) {
        event.preventDefault();event.stopPropagation();
        if (event.key.toLowerCase()==='s') this.save(); else {this.lineInput.focus();this.lineInput.select();}
      } else if(event.key==='F7') {event.preventDefault();event.stopPropagation();this.navigate(event.shiftKey?-1:1);}
    };
    this.root.addEventListener('keydown',this.shortcuts,true);
    this.observer = new ResizeObserver(()=> {if(!this.frame)this.frame=requestAnimationFrame(()=> {this.frame=undefined;this.layout();});});
    // Splitters resize the code hosts without changing the outer workspace.
    for (const host of [this.root,this.root.querySelector('[data-merge-comparison]'),this.root.querySelector('[data-git-result]')]) this.observer.observe(host);
    this.updateModelOptions(); this.update(); this.layout();
    if(this.parsed.blocks.length)this.reveal();
    } catch(error) {this.dispose();throw error;}
  }
  fontOptions() {
    const get = (key,fallback)=>this.preferences.get(`editor.${key}`,fallback,this.details.uri);
    return {fontFamily:get('fontFamily','monospace'),fontSize:get('fontSize',14),fontWeight:get('fontWeight','normal'),lineHeight:get('lineHeight',0),fontLigatures:get('fontLigatures',false)};
  }
  updateModelOptions() {
    for (const model of [this.currentModel,this.incomingModel,this.resultModel]) model.updateOptions({tabSize:this.preferences.get('editor.tabSize',4,this.details.uri),insertSpaces:this.preferences.get('editor.insertSpaces',true,this.details.uri)});
  }
  layout() {
    if(this.disposed || !this.root.clientWidth || !this.root.clientHeight)return;
    const layout = this.root.clientWidth<640 ? 'rows' : this.layoutSelect.value;
    if(this.body.dataset.layout!==layout) {
      this.splitter?.dispose();this.body.dataset.layout=layout;
      const key=layout==='rows'?'mergeRows':'mergeColumns';
      this.splitter=createGitSplitter(this.body,this.root.querySelector('.plain-git-merge-splitter'),{
        variable:'--plain-merge-split',value:this.widget[key] ?? (layout==='rows'?.45:.64),orientation:layout==='rows'?'horizontal':'vertical',
        minLeft:layout==='rows'?110:330,minRight:layout==='rows'?150:240,onChange:value=>this.widget[key]=value
      });
    }
    const comparison=this.root.querySelector('[data-merge-comparison]'),result=this.root.querySelector('[data-git-result]');
    this.diffEditor.layout({width:comparison.clientWidth,height:comparison.clientHeight});
    this.resultEditor.layout({width:result.clientWidth,height:result.clientHeight});
  }
  ranges() {
    return this.conflicts.map(block=> {
      const range=block.anchor&&this.resultModel.getDecorationRange(block.anchor);
      return range?{start:this.resultModel.getOffsetAt(range.getStartPosition()),end:this.resultModel.getOffsetAt(range.getEndPosition())}:null;
    });
  }
  setRanges(ranges) {
    const anchored=[];
    const ids=this.resultModel.deltaDecorations(this.conflicts.map(block=>block.anchor).filter(Boolean),ranges.flatMap((range,index)=> {
      if(!range)return [];
      const first=this.resultModel.getPositionAt(range.start),last=this.resultModel.getPositionAt(range.end);anchored.push(index);
      return [{range:new monaco.Range(first.lineNumber,first.column,last.lineNumber,last.column),options:{description:'merge-choice-region',stickiness:monaco.editor.TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges}}];
    }));
    for(const block of this.conflicts)block.anchor=undefined;
    anchored.forEach((index,i)=>this.conflicts[index].anchor=ids[i]);
  }
  rememberState() {
    // Store only compact range metadata at choice boundaries, not file copies
    // on every keystroke. Monaco retains the editable text and undo history.
    const offsets=new Int32Array(this.conflicts.length*2);
    this.ranges().forEach((range,index)=> {offsets[index*2]=range?.start??-1;offsets[index*2+1]=range?.end??-1;});
    this.states.set(this.resultModel.getAlternativeVersionId(),{offsets,deleted:this.deleted.checked,whole:this.whole,applied:this.conflicts.map(block=>block.applied)});
  }
  restoreState(state) {
    this.setRanges(this.conflicts.map((_,index)=>state.offsets[index*2]<0?null:{start:state.offsets[index*2],end:state.offsets[index*2+1]}));
    this.conflicts.forEach((block,index)=>block.applied=state.applied[index]);
    this.deleted.checked=state.deleted;this.whole=state.whole;this.resultEditor.updateOptions({readOnly:state.deleted});
  }
  choiceLabel(index) {
    const block=this.conflicts[index],range=block.anchor&&this.resultModel.getDecorationRange(block.anchor);
    if(!range)return this.whole?`${this.whole} file`:'Review manually';
    const text=this.resultModel.getValueInRange(range);
    if(parseMergeBlocks(text).blocks.length)return 'Unresolved';
    if(block.applied?.text===text)return {current:'Current',incoming:'Incoming',both:'Both'}[block.applied.choice] || 'Edited';
    if(text===block.current)return 'Current';
    if(text===block.incoming)return 'Incoming';
    if(text===block.current+block.incoming)return 'Both';
    return 'Edited';
  }
  selectedText(index) {
    const editor=index?this.incomingEditor:this.currentEditor,selection=editor.getSelection(),source=this.conflicts[this.active]?.sources[index];
    if(!selection||selection.isEmpty()||!source)return;
    const start=editor.getModel().getOffsetAt(selection.getStartPosition()),end=editor.getModel().getOffsetAt(selection.getEndPosition());
    if(start<source.start||end>source.end)return;
    return editor.getModel().getValueInRange(selection);
  }
  sourceSelectionChanged(index) {
    if(!this.conflicts||!this.parsed)return;
    const editor=index?this.incomingEditor:this.currentEditor,selection=editor.getSelection();
    if(selection&&!selection.isEmpty()) {
      const start=editor.getModel().getOffsetAt(selection.getStartPosition()),end=editor.getModel().getOffsetAt(selection.getEndPosition());
      const candidates=this.conflicts.flatMap((block,i)=>block.sources[index]&&start>=block.sources[index].start&&end<=block.sources[index].end?[i]:[]);
      if(candidates.length===1&&this.active!==candidates[0]) {
        this.active=candidates[0];const range=this.ranges()[this.active];
        if(range){const position=this.resultModel.getPositionAt(range.start);this.resultEditor.setPosition(position);this.resultEditor.revealLineInCenter(position.lineNumber);}
      }
    }
    this.updateControls();
  }
  update() {
    if(this.disposed)return;
    clearTimeout(this.timer);this.parsed=parseMergeBlocks(this.resultModel.getValue());
    this.active=Math.min(this.active,Math.max(0,this.conflicts.length-1));
    const rows=[];
    for(const block of this.parsed.blocks) {
      const decorate=(start,end,kind)=> {
        if(end<=start)return;
        const first=this.resultModel.getPositionAt(start),last=this.resultModel.getPositionAt(Math.max(start,end-1));
        rows.push({range:new monaco.Range(first.lineNumber,1,last.lineNumber,1),options:{isWholeLine:true,className:`plain-merge-${kind}`,overviewRuler:{color:{id:'editorOverviewRuler.modifiedForeground'},position:monaco.editor.OverviewRulerLane.Full}}});
      };
      decorate(block.start,block.currentStart,'marker');decorate(block.currentStart,block.currentEnd,'current');
      decorate(block.separator,block.incomingStart,'marker');decorate(block.incomingStart,block.incomingEnd,'incoming');decorate(block.incomingEnd,block.end,'marker');
    }
    this.labels=this.conflicts.map((_,index)=>this.choiceLabel(index));
    this.decorations.set(rows);this.updateInlineButtons();this.root.querySelector('[data-merge-result-lines]').textContent=`${this.resultModel.getLineCount()} lines`;
    this.lineInput.max=String(this.resultModel.getLineCount());this.updateControls();
  }
  updateActiveFromCursor() {
    if(!this.parsed || this.disposed)return;
    const position=this.resultEditor.getPosition();if(!position)return;
    const offset=this.resultModel.getOffsetAt(position),index=this.ranges().findIndex(range=>range&&offset>=range.start&&offset<=range.end);
    if(index!==-1&&index!==this.active){this.active=index;this.updateControls();}
  }
  updateControls() {
    if(this.disposed || !this.parsed)return;
    const count=this.parsed.blocks.length,invalid=this.parsed.malformed,range=this.ranges()[this.active],total=this.conflicts.length;
    this.counter.textContent=invalid?'Repair edited markers':count?`${count} unresolved`:'All resolved';this.counter.title=`${total} original conflicts in this file`;
    const labels=this.conflicts.map((_,index)=>`Conflict ${index+1} · ${this.labels[index]}`);
    const activeLabel=labels[this.active]||'Review Result',activeChoice=activeLabel.split(' · ')[1];
    this.root.querySelector('[data-merge-block-label]').textContent=activeLabel+(range?' · Line '+this.resultModel.getPositionAt(range.start).lineNumber:'');
    if(labels.some((label,index)=>this.conflictSelect.options[index]?.text!==label)||this.conflictSelect.options.length!==labels.length) {
      this.conflictSelect.replaceChildren(...labels.map((label,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=label;return option;}));
    }
    this.conflictSelect.value=String(this.active);this.conflictSelect.disabled=this.saving||!total;
    for(const button of this.root.querySelectorAll('[data-merge-action]')) {
      const action=button.dataset.mergeAction;
      const requiresBlock=['current','incoming','both','selection-current','selection-incoming'].includes(action);
      button.disabled=this.saving || (requiresBlock&&(!range||invalid||this.deleted.checked));
      if(action==='previous'||action==='next')button.disabled=this.saving||total<2;
      if(action==='undo'||action==='redo')button.disabled=this.saving||!(action==='undo'?this.resultModel.canUndo():this.resultModel.canRedo());
      if(action==='selection-current' || action==='selection-incoming') {
        button.disabled ||= !this.selectedText(action==='selection-current'?0:1);
        button.classList.toggle('plain-merge-selection-ready',!button.disabled);
        button.title=button.disabled?`Select lines inside conflict ${this.active+1} to use them`:`Replace conflict ${this.active+1} with the selected lines. You can change this choice later.`;
      }
      if(['current','incoming','both'].includes(action))button.setAttribute('aria-pressed',String(activeChoice?.toLowerCase().replace(/ file$/,'')===action));
    }
    for(const button of this.root.querySelectorAll('[data-merge-inline-choice]')) button.disabled=this.saving || invalid || this.deleted.checked;
    this.saveButton.disabled=this.saving || (!this.deleted.checked && (count>0 || invalid));
    this.help.textContent=this.saving?'Saving and staging…':invalid?'Repair the edited conflict markers, or use Undo.':this.whole?`Whole ${this.whole} file chosen. You can choose another file or revise an individual conflict.`:!range&&total?'This region cannot be located safely. Use Reset choices to review the original conflicts.':count?'Choices affect one conflict. Both keeps Current, then Incoming.':'Ready to save. You can still change a choice or edit Result.';
  }
  navigate(delta) {
    this.update();if(!this.conflicts.length)return;
    this.active=(this.active+delta+this.conflicts.length)%this.conflicts.length;this.reveal();
  }
  reveal() {
    const block=this.conflicts[this.active];if(!block)return;
    const region=this.ranges()[this.active];
    if(region){const position=this.resultModel.getPositionAt(region.start);this.resultEditor.setPosition(position);this.resultEditor.revealLineInCenter(position.lineNumber);}
    for(const [index,editor] of [this.currentEditor,this.incomingEditor].entries()) {
      this.sourceDecorations[index].clear();const source=block.sources[index];if(!source)continue;
      const first=editor.getModel().getPositionAt(source.start),last=editor.getModel().getPositionAt(source.end);
      const range=new monaco.Range(first.lineNumber,first.column,last.lineNumber,last.column);
      editor.revealRangeInCenter(range);this.sourceDecorations[index].set([{range,options:{isWholeLine:true,className:'plain-merge-selected-source'}}]);
    }
    this.updateControls();
  }
  updateChangeButtons() {
    if(this.disposed)return;
    this.changes=this.diffEditor.getLineChanges() || [];
    for(const [index,prefix] of ['original','modified'].entries()) this.changeDecorations[index].set(this.changes.filter(change=>change[`${prefix}EndLineNumber`]>0).map(change=>({
      range:new monaco.Range(change[`${prefix}StartLineNumber`],1,change[`${prefix}StartLineNumber`],1),
      options:{glyphMarginClassName:'codicon codicon-checklist plain-merge-select-change',glyphMarginHoverMessage:{value:'Select changed lines'},stickiness:monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges}
    })));
  }
  selectChange(index,line) {
    if(this.disposed || this.saving)return;
    const prefix=index?'modified':'original',change=this.changes?.find(item=>item[`${prefix}EndLineNumber`]>0&&line>=item[`${prefix}StartLineNumber`]&&line<=item[`${prefix}EndLineNumber`]);
    if(!change)return;
    const editor=index?this.incomingEditor:this.currentEditor,model=editor.getModel(),first=change[`${prefix}StartLineNumber`],last=change[`${prefix}EndLineNumber`];
    editor.setSelection(new monaco.Range(first,1,last<model.getLineCount()?last+1:last,last<model.getLineCount()?1:model.getLineMaxColumn(last)));editor.focus();
    const candidates=[];
    for(const [number,block] of this.conflicts.entries()) {
      const source=block.sources[index];if(!source)continue;
      if(model.getPositionAt(source.start).lineNumber<=last&&model.getPositionAt(Math.max(source.start,source.end-1)).lineNumber>=first)candidates.push(number);
    }
    if(candidates.length===1) {
      this.active=candidates[0];const source=this.conflicts[this.active].sources[index];
      const selection=editor.getSelection(),first=model.getPositionAt(Math.max(source.start,model.getOffsetAt(selection.getStartPosition()))),last=model.getPositionAt(Math.min(source.end,model.getOffsetAt(selection.getEndPosition())));
      editor.setSelection(new monaco.Range(first.lineNumber,first.column,last.lineNumber,last.column));
      const region=this.ranges()[this.active];if(region){const line=this.resultModel.getPositionAt(region.start).lineNumber;this.resultEditor.setPosition({lineNumber:line,column:1});this.resultEditor.revealLineInCenter(line);}
      this.updateControls();
    }
    this.help.textContent=candidates.length===1?`Use selected lines to replace conflict ${this.active+1}. You can change this choice later.`:'This difference is outside a conflict. Edit Result to include it, or choose a whole file.';
  }
  updateInlineButtons() {
    const ranges=this.ranges();
    this.resultEditor.changeViewZones(accessor=> {
      for(const id of this.inlineZones || [])accessor.removeZone(id);
      this.inlineZones=this.conflicts.flatMap((block,index)=> {
        const region=ranges[index];if(!region)return [];
        const choiceLabel=this.labels[index];
        const node=document.createElement('div');node.className='plain-merge-inline-actions';node.setAttribute('aria-label',`Conflict ${index+1}`);
        const label=document.createElement('span');label.textContent=`Conflict ${index+1} · ${choiceLabel}`;node.append(label);
        const buttons=document.createElement('div');node.append(buttons);node.addEventListener('mousedown',event=>event.stopPropagation());
        for(const [choice,text] of [['current','Current'],['incoming','Incoming'],['both','Both']]) {
          const button=document.createElement('button');button.type='button';button.textContent=text;button.dataset.mergeInlineChoice=choice;
          button.setAttribute('aria-pressed',String(choiceLabel.toLowerCase()===choice));
          button.addEventListener('click',()=> {if(!button.disabled&&!this.widget.busy)this.choose(choice,undefined,block);});buttons.append(button);
        }
        return [accessor.addZone({afterLineNumber:this.resultModel.getPositionAt(region.start).lineNumber-1,heightInPx:52,domNode:node,suppressMouseDown:false})];
      });
    });
  }
  choose(choice, selected, block, source) {
    if(this.saving)return;
    this.update();
    try {
      const index=block?this.conflicts.indexOf(block):this.active,ranges=this.ranges(),range=ranges[index];
      if(!range||this.parsed.malformed)throw new Error('This region cannot be located safely. Use Reset choices or edit Result.');
      if(ranges.some((other,i)=>i!==index&&other&&other.start<range.end&&other.end>range.start))throw new Error('These regions overlap after editing. Use Undo or Reset choices before applying a version.');
      const value=this.resultModel.getValue(),eol=this.resultModel.getEOL(),text=choiceText(this.conflicts[index],choice,selected,eol,range.end<value.length||value.endsWith('\n')).replace(/\r?\n/g,eol);
      this.rememberState();this.active=index;this.replace(range.start,range.end,text);
      this.conflicts[index].applied=choice==='selection'&&!source?undefined:{choice:choice==='selection'?source:choice,text};
      this.setRanges(moveConflictRanges(ranges,index,range.start,range.end,text.length));this.active=index;this.whole=undefined;this.rememberState();this.update();this.reveal();this.resultEditor.focus();
    } catch(error) {this.help.textContent=error.message;}
  }
  replace(start,end,text) {
    const first=this.resultModel.getPositionAt(start),last=this.resultModel.getPositionAt(end);
    this.resultEditor.pushUndoStop();this.resultEditor.executeEdits('singularity-merge',[{range:new monaco.Range(first.lineNumber,first.column,last.lineNumber,last.column),text,forceMoveMarkers:false}]);this.resultEditor.pushUndoStop();
  }
  async undoRedo(action) {
    if(this.saving||this.widget.busy||this.disposed)return;
    try {this.resultEditor.focus();await this.resultModel[action]();if(!this.disposed)this.update();}
    catch(error){if(!this.disposed)this.help.textContent=error.message;}
  }
  useWhole(version) {
    this.rememberState();
    const eol=this.resultModel.getEOL(),text=version.text.replace(/^\uFEFF/,'').replace(/\r?\n/g,eol);
    this.deleted.checked=false;this.resultEditor.updateOptions({readOnly:false});this.replace(0,this.resultModel.getValueLength(),text);
    const index=version===this.details.current?0:1;this.setRanges(locateConflictSources(this.initialResult,text,index?'incoming':'current'));
    for(const block of this.conflicts) {
      const range=block.anchor&&this.resultModel.getDecorationRange(block.anchor);
      block.applied=range?{choice:index?'incoming':'current',text:this.resultModel.getValueInRange(range)}:undefined;
    }
    this.whole=index?'Incoming':'Current';this.deleted.checked=version.deleted;this.resultEditor.updateOptions({readOnly:version.deleted});this.widget.setResolutionDirty(true);this.rememberState();this.update();this.reveal();this.resultEditor.focus();
  }
  resetChoices() {
    this.rememberState();this.deleted.checked=false;this.resultEditor.updateOptions({readOnly:false});
    this.replace(0,this.resultModel.getValueLength(),this.initialResult);this.setRanges(this.conflicts.map(({start,end})=>({start,end})));
    for(const block of this.conflicts)block.applied=undefined;
    this.whole=undefined;this.deleted.checked=this.details.deleted;this.resultEditor.updateOptions({readOnly:this.deleted.checked});this.rememberState();this.update();this.reveal();
  }
  goToLine() {
    const value=Number(this.lineInput.value);if(!Number.isFinite(value))return;
    const line=Math.max(1,Math.min(this.resultModel.getLineCount(),Math.floor(value)));this.resultEditor.setPosition({lineNumber:line,column:1});this.resultEditor.revealLineInCenter(line);this.resultEditor.focus();
  }
  save() {
    if(this.pendingSave)return this.pendingSave;
    this.pendingSave=this.doSave().finally(()=>{this.pendingSave=undefined;});return this.pendingSave;
  }
  async doSave() {
    if(this.saving || this.widget.busy || this.disposed)return;
    this.update();
    if(!this.deleted.checked&&(this.parsed.blocks.length||this.parsed.malformed)){
      this.widget.notice='Resolve all conflict blocks before saving and staging.';this.widget.status.textContent=this.widget.notice;this.help.textContent=this.widget.notice;this.reveal();return;
    }
    this.saving=true;this.resultEditor.updateOptions({readOnly:true});this.updateControls();
    try {await this.widget.workspaceOperation('resolveConflict',{uri:this.details.uri,stamp:this.details.stamp,result:this.resultModel.getValue(undefined,true),deleted:this.deleted.checked});}
    finally {if(!this.disposed){this.saving=false;this.resultEditor.updateOptions({readOnly:this.deleted.checked});this.updateControls();}}
  }
  dispose() {
    if(this.disposed)return;
    this.disposed=true;clearTimeout(this.timer);if(this.frame)cancelAnimationFrame(this.frame);
    this.widget.node.classList.remove('plain-git-expanded-merge');
    this.observer?.disconnect();this.splitter?.dispose();if(this.shortcuts)this.root.removeEventListener('keydown',this.shortcuts,true);
    this.disposables.forEach(item=>item.dispose());this.decorations?.clear();this.sourceDecorations?.forEach(item=>item.clear());this.changeDecorations?.forEach(item=>item.clear());
    if(this.resultModel&&this.conflicts)this.resultModel.deltaDecorations(this.conflicts.map(block=>block.anchor).filter(Boolean),[]);
    this.states?.clear();
    this.diffEditor?.dispose();this.resultEditor?.dispose();this.currentModel?.dispose();this.incomingModel?.dispose();this.resultModel?.dispose();
  }
}

module.exports = {MergeResolutionEditor};
