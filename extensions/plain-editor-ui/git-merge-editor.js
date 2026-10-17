'use strict';

const monaco = require('@theia/monaco-editor-core');
const {PreferenceService} = require('@theia/core/lib/common/preferences/preference-service');
const {parseMergeBlocks,resolveBlock} = require('./git-merge-blocks.cjs');
const {createGitSplitter} = require('./git-splitter');
let sequence = 0;

class MergeResolutionEditor {
  constructor(widget, details) {
    this.widget = widget; this.details = details; this.disposables = []; this.active = 0;
    this.preferences = widget.container.get(PreferenceService);
    this.root = document.createElement('div'); this.root.className = 'plain-git-merge-editor';
    this.root.innerHTML = `<div class="plain-git-merge-toolbar">
      <button data-merge-action="files">Show files</button><button data-merge-action="previous" title="Previous conflict (Shift+F7)">Previous</button><button data-merge-action="next" title="Next conflict (F7)">Next</button>
      <span data-merge-counter role="status" aria-live="polite"></span>
      <label>Layout <select data-merge-layout aria-label="Merge layout"><option value="columns">Columns</option><option value="rows">Rows</option></select></label>
      <label><input type="checkbox" data-merge-wrap>Wrap lines</label><button data-merge-action="expand" aria-pressed="false">Expand</button><button data-git-action="fullscreen">Full screen</button>
    </div>
    <div class="plain-git-merge-body">
      <section class="plain-git-merge-comparison" aria-label="Compare current and incoming files">
        <div class="plain-git-merge-source-headings"><div><strong>Current</strong><small data-merge-current-lines></small><div class="plain-git-merge-source-actions"><button data-merge-action="selection-current" title="Use the selected current text for the active conflict only">Use selected lines</button><button data-merge-action="whole-current" title="Replace the entire result with the current file">Use this file</button></div></div><div><strong>Incoming</strong><small data-merge-incoming-lines></small><div class="plain-git-merge-source-actions"><button data-merge-action="selection-incoming" title="Use the selected incoming text for the active conflict only">Use selected lines</button><button data-merge-action="whole-incoming" title="Replace the entire result with the incoming file">Use this file</button></div></div></div>
        <div class="plain-git-merge-diff" data-merge-comparison></div>
        <div class="plain-git-merge-diff-navigation"><button data-merge-action="previous-diff">Previous difference</button><button data-merge-action="next-diff">Next difference</button><small>Click the gutter icon to select changed lines</small></div>
      </section><div class="plain-git-merge-splitter" aria-label="Resize comparison and result"></div>
      <section class="plain-git-merge-result-pane" aria-label="Editable merge result">
        <div class="plain-git-merge-result-heading"><strong>Result</strong><small data-merge-result-lines></small><label>Line <input type="number" min="1" data-merge-line aria-label="Go to result line" title="Go to line (Ctrl+G / Command+G)"></label><button data-merge-action="line">Go</button></div>
        <div class="plain-git-merge-block-actions" aria-label="Apply a choice to the active conflict only"><span data-merge-block-label>Active conflict</span><button data-merge-action="current">Use current</button><button data-merge-action="incoming">Use incoming</button><button data-merge-action="both">Use both</button></div>
        <div class="plain-git-merge-result-code" data-git-result></div>
      </section>
    </div>
    <div class="plain-git-merge-footer"><label><input type="checkbox" data-merge-delete>Delete this file</label><span data-merge-help role="status" aria-live="polite"></span><button data-git-save-resolution>Save and stage</button><button data-merge-action="discard" title="Discard unsaved resolution edits">Discard</button></div>`;
    widget.review.append(this.root);
    this.body = this.root.querySelector('.plain-git-merge-body');
    this.counter = this.root.querySelector('[data-merge-counter]'); this.help = this.root.querySelector('[data-merge-help]');
    this.deleted = this.root.querySelector('[data-merge-delete]'); this.deleted.checked = details.deleted;
    this.layoutSelect = this.root.querySelector('[data-merge-layout]'); this.layoutSelect.value = widget.mergeLayout || 'columns';
    this.lineInput = this.root.querySelector('[data-merge-line]'); this.saveButton = this.root.querySelector('[data-git-save-resolution]');
    const file = decodeURIComponent(details.uri.split('/').pop());
    const extension = /\.[^.]+$/.exec(file)?.[0].toLowerCase();
    const language = monaco.languages.getLanguages().find(item=>item.filenames?.includes(file) || item.extensions?.includes(extension))?.id || 'plaintext';
    const id = ++sequence;
    const makeModel = (name,text) => monaco.editor.createModel(text,language,monaco.Uri.parse(`singularity-merge:/${id}/${name}/${encodeURIComponent(file)}`));
    try {
    this.currentModel = makeModel('current',details.current.text); this.incomingModel = makeModel('incoming',details.incoming.text); this.resultModel = makeModel('result',details.result);
    const options = {...this.fontOptions(),minimap:{enabled:false},scrollBeyondLastLine:false,wordWrap:'off',lineNumbers:'on',glyphMargin:true,automaticLayout:false,contextmenu:true};
    this.diffEditor = monaco.editor.createDiffEditor(this.root.querySelector('[data-merge-comparison]'), {
      ...options,readOnly:true,originalEditable:false,renderSideBySide:true,renderSideBySideInlineBreakpoint:0,
      useInlineViewWhenSpaceIsLimited:false,enableSplitViewResizing:true,ignoreTrimWhitespace:false,maxComputationTime:2000,hideUnchangedRegions:{enabled:false}
    });
    this.diffEditor.setModel({original:this.currentModel,modified:this.incomingModel});
    this.currentEditor = this.diffEditor.getOriginalEditor(); this.incomingEditor = this.diffEditor.getModifiedEditor();
    this.currentEditor.updateOptions({ariaLabel:'Current file, read only'}); this.incomingEditor.updateOptions({ariaLabel:'Incoming file, read only'});
    this.resultEditor = monaco.editor.create(this.root.querySelector('[data-git-result]'), {...options,model:this.resultModel,readOnly:details.deleted,ariaLabel:'Merge result'});
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
    this.disposables.push(this.resultModel.onDidChangeContent(()=> {
      widget.setResolutionDirty(true); clearTimeout(this.timer); this.timer = setTimeout(()=>this.update(),120);
    }), this.resultEditor.onDidChangeCursorPosition(()=>this.updateActiveFromCursor()), this.currentEditor.onDidChangeCursorSelection(()=>this.updateControls()), this.incomingEditor.onDidChangeCursorSelection(()=>this.updateControls()));
    this.disposables.push(this.preferences.onPreferencesChanged(changes=> {
      if (Object.keys(changes).some(key=>/^editor\.(font|lineHeight|tabSize|insertSpaces)/.test(key))) {
        this.diffEditor.updateOptions(this.fontOptions()); this.resultEditor.updateOptions(this.fontOptions()); this.updateModelOptions(); this.layout();
      }
    }));
    this.root.addEventListener('click',event=> {
      const button = event.target.closest('button'); if (!button || button.disabled || this.saving || widget.busy) return;
      if (button === this.saveButton) { this.save(); return; }
      const action = button.dataset.mergeAction;
      if (['current','incoming','both'].includes(action)) this.choose(action);
      else if (action === 'next' || action === 'previous') this.navigate(action === 'next' ? 1 : -1);
      else if (action === 'next-diff' || action === 'previous-diff') this.diffEditor.goToDiff(action === 'next-diff' ? 'next' : 'previous');
      else if (action === 'selection-current' || action === 'selection-incoming') {
        const editor = action === 'selection-current' ? this.currentEditor : this.incomingEditor;
        this.choose('selection',editor.getModel().getValueInRange(editor.getSelection()));
      } else if (action === 'whole-current' || action === 'whole-incoming') this.useWhole(action === 'whole-current' ? details.current : details.incoming);
      else if (action === 'expand') {
        const expanded=widget.node.classList.toggle('plain-git-expanded-merge');button.setAttribute('aria-pressed',String(expanded));
        button.textContent=expanded?'Restore':'Expand';this.layout();
      } else if (action === 'files') {
        const content = widget.node.querySelector('.plain-git-content'); content.classList.toggle('plain-git-show-conflict-files');
        button.textContent = content.classList.contains('plain-git-show-conflict-files') ? 'Hide files' : 'Show files';
      } else if (action === 'line') this.goToLine();
      else if (action === 'discard') widget.perform(async()=> {widget.setResolutionDirty(false);widget.editingConflict=false;widget.selectedResource=undefined;widget.viewKey=undefined;},widget.confirmation('discardResolution',{file}));
    });
    this.deleted.addEventListener('change',()=> { widget.setResolutionDirty(true);this.resultEditor.updateOptions({readOnly:this.deleted.checked});this.updateControls(); });
    this.root.querySelector('[data-merge-wrap]').addEventListener('change',event=> {const wordWrap=event.target.checked?'on':'off';this.diffEditor.updateOptions({wordWrap});this.resultEditor.updateOptions({wordWrap});});
    this.layoutSelect.addEventListener('change',()=> {widget.mergeLayout=this.layoutSelect.value;this.layout();});
    this.lineInput.addEventListener('keydown',event=> {if(event.key==='Enter'){event.preventDefault();this.goToLine();}});
    this.shortcuts = event => {
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
  update() {
    if(this.disposed)return;
    clearTimeout(this.timer);this.parsed=parseMergeBlocks(this.resultModel.getValue());
    this.active=Math.min(this.active,Math.max(0,this.parsed.blocks.length-1));
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
    this.decorations.set(rows);this.updateInlineButtons();this.root.querySelector('[data-merge-result-lines]').textContent=`${this.resultModel.getLineCount()} lines`;
    this.lineInput.max=String(this.resultModel.getLineCount());this.updateControls();
  }
  updateActiveFromCursor() {
    if(!this.parsed || this.disposed)return;
    const position=this.resultEditor.getPosition();if(!position)return;
    const offset=this.resultModel.getOffsetAt(position),index=this.parsed.blocks.findIndex(block=>offset>=block.start&&offset<=block.end);
    if(index!==-1&&index!==this.active){this.active=index;this.updateControls();}
  }
  updateControls() {
    if(this.disposed || !this.parsed)return;
    const count=this.parsed.blocks.length,invalid=this.parsed.malformed,block=this.parsed.blocks[this.active];
    this.counter.textContent=invalid?'Repair edited conflict markers':count?`Conflict ${this.active+1} of ${count} remaining`:'No unresolved text conflicts';
    this.root.querySelector('[data-merge-block-label]').textContent=block?`Conflict ${this.active+1} · Result line ${this.resultModel.getPositionAt(block.start).lineNumber}`:'Edit Result to finish';
    for(const button of this.root.querySelectorAll('[data-merge-action]')) {
      const action=button.dataset.mergeAction;
      const requiresBlock=['current','incoming','both','previous','next','selection-current','selection-incoming'].includes(action);
      button.disabled=this.saving || (requiresBlock&&(!count||invalid||this.deleted.checked));
      if(action==='selection-current' || action==='selection-incoming') button.disabled ||= (action==='selection-current'?this.currentEditor:this.incomingEditor).getSelection()?.isEmpty() !== false;
    }
    for(const button of this.root.querySelectorAll('[data-merge-inline-choice]')) button.disabled=this.saving || invalid || this.deleted.checked;
    this.saveButton.disabled=this.saving || (!this.deleted.checked && (count>0 || invalid));
    this.help.textContent=this.saving?'Saving and staging…':invalid?'Repair the markers or resolve them manually in Result.':count?'Choices affect only the active conflict. You can also select source lines or edit Result.':'Review Result, then save and stage. Use Undo to revise a choice.';
  }
  navigate(delta) {
    this.update();if(!this.parsed.blocks.length || this.parsed.malformed)return;
    this.active=(this.active+delta+this.parsed.blocks.length)%this.parsed.blocks.length;this.reveal();
  }
  reveal() {
    const block=this.parsed.blocks[this.active];if(!block)return;
    const position=this.resultModel.getPositionAt(block.start);this.resultEditor.setPosition(position);this.resultEditor.revealLineInCenter(position.lineNumber);
    for(const [index,editor,text] of [[0,this.currentEditor,block.current],[1,this.incomingEditor,block.incoming]]) {
      this.sourceDecorations[index].clear();if(!text)continue;
      const model=editor.getModel(),matches=model.findMatches(text.replace(/\r?\n/g,model.getEOL()),false,false,true,null,false,2);
      // Repeated snippets have no unique source location. Keep the independent
      // full-file comparison rather than jumping to a potentially wrong copy.
      if(matches.length===1) {
        editor.revealRangeInCenter(matches[0].range);this.sourceDecorations[index].set([{range:matches[0].range,options:{isWholeLine:true,className:'plain-merge-selected-source'}}]);
      }
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
    for(const [number,block] of this.parsed.blocks.entries()) {
      const text=(index?block.incoming:block.current).replace(/\r?\n/g,model.getEOL());if(!text)continue;
      const matches=model.findMatches(text,false,false,true,null,false,2);
      if(matches.length===1 && matches[0].range.startLineNumber<=last && matches[0].range.endLineNumber>=first)candidates.push(number);
    }
    if(candidates.length===1) {
      this.active=candidates[0];const line=this.resultModel.getPositionAt(this.parsed.blocks[this.active].start).lineNumber;
      this.resultEditor.setPosition({lineNumber:line,column:1});this.resultEditor.revealLineInCenter(line);this.updateControls();
    }
    this.help.textContent='Changed lines selected. Use selected lines to replace the active conflict.';
  }
  updateInlineButtons() {
    this.resultEditor.changeViewZones(accessor=> {
      for(const id of this.inlineZones || [])accessor.removeZone(id);
      this.inlineZones=this.parsed.blocks.map((block,index)=> {
        const node=document.createElement('div');node.className='plain-merge-inline-actions';node.setAttribute('aria-label',`Conflict ${index+1}`);
        const label=document.createElement('span');label.textContent=`Conflict ${index+1}`;node.append(label);
        const buttons=document.createElement('div');node.append(buttons);node.addEventListener('mousedown',event=>event.stopPropagation());
        for(const [choice,text] of [['current','Current'],['incoming','Incoming'],['both','Both']]) {
          const button=document.createElement('button');button.type='button';button.textContent=text;button.dataset.mergeInlineChoice=choice;
          button.addEventListener('click',()=> {if(!button.disabled&&!this.widget.busy)this.choose(choice,undefined,block);});buttons.append(button);
        }
        return accessor.addZone({afterLineNumber:this.resultModel.getPositionAt(block.start).lineNumber-1,heightInPx:52,domNode:node,suppressMouseDown:false});
      });
    });
  }
  choose(choice, selected, block) {
    if(this.saving)return;
    this.update();
    try {
      const edit=resolveBlock(this.resultModel.getValue(),block || this.parsed.blocks[this.active],choice,selected);
      if(block)this.active=this.parsed.blocks.findIndex(item=>item.start===block.start&&item.end===block.end);
      this.replace(edit.start,edit.end,edit.text);this.update();this.reveal();this.resultEditor.focus();
    } catch(error) {this.help.textContent=error.message;}
  }
  replace(start,end,text) {
    const first=this.resultModel.getPositionAt(start),last=this.resultModel.getPositionAt(end);
    this.resultEditor.pushUndoStop();this.resultEditor.executeEdits('singularity-merge',[{range:new monaco.Range(first.lineNumber,first.column,last.lineNumber,last.column),text,forceMoveMarkers:true}]);this.resultEditor.pushUndoStop();
  }
  useWhole(version) {
    const eol=this.resultModel.getEOL(),text=version.text.replace(/^\uFEFF/,'').replace(/\r?\n/g,eol);
    this.deleted.checked=false;this.resultEditor.updateOptions({readOnly:false});this.replace(0,this.resultModel.getValueLength(),text);
    this.deleted.checked=version.deleted;this.resultEditor.updateOptions({readOnly:version.deleted});this.widget.setResolutionDirty(true);this.update();this.resultEditor.focus();
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
    this.diffEditor?.dispose();this.resultEditor?.dispose();this.currentModel?.dispose();this.incomingModel?.dispose();this.resultModel?.dispose();
  }
}

module.exports = {MergeResolutionEditor};
