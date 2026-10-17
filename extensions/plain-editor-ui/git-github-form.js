'use strict';

function createGitHubForm(widget) {
  const root = widget.root;
  let alive = true, account, source, receipt, pending = false;
  const form = document.createElement('form'); form.className = 'plain-git-github-form'; form.dataset.gitGithubForm = '';
  form.innerHTML = `<p>Create a repository in your account or organization. Choose whether to publish this project's committed history or start a separate repository on GitHub.</p>
    <div class="plain-git-github-login"><button type="button" data-github-signin>Connect GitHub account</button><span data-github-account></span></div>
    <div class="plain-git-github-fields">
      <label>Owner<select name="owner"><option value="">Connect GitHub first</option></select></label>
      <label data-github-org hidden>Organization name<input name="organization" maxlength="39" autocomplete="off"></label>
      <label>Repository name<input name="name" required maxlength="100" autocomplete="off" spellcheck="false"></label>
      <label class="plain-git-wide">Description<textarea name="description" rows="2" maxlength="350"></textarea></label>
      <label>Visibility<select name="visibility"><option value="private">Private</option><option value="public">Public</option></select></label>
      <label>Default branch on GitHub<input name="defaultBranch" required value="main" autocomplete="off" spellcheck="false"></label>
      <label class="plain-git-wide">Contents<select name="mode"><option value="publish">Publish this project's committed history</option><option value="github">Create on GitHub with a README</option></select></label>
      <label data-github-remote>Local remote name<input name="remoteName" value="origin" autocomplete="off" spellcheck="false"></label>
      <p data-github-source class="plain-git-muted"></p>
      <label data-github-template hidden>.gitignore template<select name="gitignore"><option value="">None</option></select></label>
      <label data-github-template hidden>License<select name="license"><option value="">None</option></select></label>
      <details class="plain-git-wide"><summary>Repository options</summary><div class="plain-git-github-options">
        <label><input type="checkbox" name="issues" checked>Issues</label><label><input type="checkbox" name="wiki">Wiki</label><label><input type="checkbox" name="discussions">Discussions</label>
        <label><input type="checkbox" name="mergeCommit" checked>Allow merge commits</label><label><input type="checkbox" name="squashMerge" checked>Allow squash merges</label><label><input type="checkbox" name="rebaseMerge">Allow rebase merges</label>
        <label><input type="checkbox" name="deleteBranch">Delete branches after merging</label><label><input type="checkbox" name="template">Make this a template repository</label>
      </div></details>
    </div>
    <p data-github-summary></p><p role="status" aria-live="polite" data-github-status></p>
    <div class="plain-git-github-buttons"><button type="submit" data-github-create disabled>Create repository</button><button type="button" data-github-finish hidden>Finish setup</button><button type="button" data-github-close>Cancel</button></div>`;
  widget.review.append(form);
  const field = name => form.elements.namedItem(name);
  const status = form.querySelector('[data-github-status]'), submit = form.querySelector('[data-github-create]');
  const signin = form.querySelector('[data-github-signin]'), finish = form.querySelector('[data-github-finish]');
  const suggestion = root ? widget.select.title.split(/[\\/]/).pop().replace(/[^A-Za-z0-9_.-]/g,'-') : '';
  field('name').value = suggestion;
  field('defaultBranch').value = widget.info?.head?.name || 'main';
  const publishOption = field('mode').querySelector('[value="publish"]');
  publishOption.disabled = !widget.info?.head?.commit || !widget.info?.head?.name;
  if (publishOption.disabled) field('mode').value = 'github';
  function update() {
    const publish = field('mode').value === 'publish';
    field('organization').required = field('owner').value === '@organization';
    form.querySelector('[data-github-org]').hidden = !field('organization').required;
    form.querySelector('[data-github-remote]').hidden = !publish;
    for (const node of form.querySelectorAll('[data-github-template]')) node.hidden = publish;
    form.querySelector('[data-github-source]').textContent = publish
      ? `Source: ${source?.branch || widget.info?.head?.name || 'local branch'}${source?.commit ? ' · '+source.commit.slice(0,7) : ''}. Uncommitted changes stay local.`
      : 'Starts with a README so the selected default branch exists. Your local project is not connected or changed.';
    const owner = field('owner').value === '@organization' ? field('organization').value : field('owner').value;
    form.querySelector('[data-github-summary]').textContent = `${field('visibility').value === 'private' ? 'Private' : 'Public'} repository: ${owner || 'owner'}/${field('name').value || 'name'} · Default branch: ${field('defaultBranch').value || 'main'}${publish ? ' · Connect and publish committed history' : ''}`;
    submit.textContent = publish ? 'Create and publish' : 'Create repository';
    submit.disabled = pending || !account || !!receipt;
  }
  async function run(action, input) {
    if (pending) return;
    pending = true; for (const node of form.querySelectorAll('input,select,textarea,button')) node.disabled = true;
    status.textContent = action === 'setup' ? 'Connecting to GitHub…' : 'Working…';
    let result;
    const confirmation=action==='create'?widget.confirmation('createGitHub',{target:`${input.owner}/${input.name} (${input.visibility})`,branch:input.defaultBranch}):action==='finish'?widget.confirmation('finishGitHub'):undefined;
    await widget.perform(async () => { result = await widget.commands.executeCommand('git.singularityGitHub',root,action,input); return result; },confirmation);
    if (!alive) return;
    pending = false;
    for (const node of form.querySelectorAll('input,select,textarea,button')) node.disabled = false;
    signin.disabled = !!account; publishOption.disabled = !source?.branch || !source?.commit;
    if (!result) status.textContent = widget.notice || 'Request cancelled.';
    update(); return result;
  }
  signin.addEventListener('click', async () => {
    const result = await run('setup'); if (!alive || !result) return;
    account = result.login; source = result.source;
    const option = (value,label) => { const node = document.createElement('option'); node.value=value;node.textContent=label;return node; };
    field('owner').replaceChildren(option(account,account),option('@organization','Organization…'));
    signin.hidden = true; form.querySelector('[data-github-account]').textContent = `Connected as ${account}`;
    publishOption.disabled = !source?.branch || !source?.commit;
    if (publishOption.disabled) field('mode').value = 'github';
    let remote = 'origin', index = 1; while (source?.remoteNames.includes(remote)) remote = `github${index++}`; field('remoteName').value = remote;
    for (const name of result.gitignores) field('gitignore').append(option(name,name));
    for (const license of result.licenses) field('license').append(option(license.key,license.name));
    status.textContent = result.warning || ''; update();
  });
  function showResult(result) {
    if (!result) return;
    receipt = result.receipt; status.replaceChildren(document.createTextNode(result.message+' '));
    const link = document.createElement('a'); link.href=result.url;link.target='_blank';link.rel='noreferrer';link.textContent='Open repository on GitHub';status.append(link);
    for (const node of form.querySelectorAll('.plain-git-github-fields input,.plain-git-github-fields select,.plain-git-github-fields textarea')) node.disabled = true;
    submit.hidden = true; finish.hidden = result.complete;
    form.querySelector('[data-github-close]').textContent = 'Done';
    update();
  }
  form.addEventListener('input',update);form.addEventListener('change',update);
  form.addEventListener('submit',async event => {
    event.preventDefault(); if (pending || receipt || !account) return;
    const input = Object.fromEntries(['name','description','visibility','defaultBranch','mode','remoteName','gitignore','license'].map(name=>[name,field(name).value.trim()]));
    input.owner = field('owner').value === '@organization' ? field('organization').value.trim() : account;
    for (const name of ['issues','wiki','discussions','mergeCommit','squashMerge','rebaseMerge','deleteBranch','template']) input[name] = field(name).checked;
    input.sourceBranch = source?.branch; input.sourceCommit = source?.commit;
    showResult(await run('create',input));
  });
  finish.addEventListener('click',async () => showResult(await run('finish',{receipt})));
  form.querySelector('[data-github-close]').addEventListener('click',()=>widget.closeGitHubForm());
  update();return {dispose(){alive=false;}};
}

module.exports = {createGitHubForm};
