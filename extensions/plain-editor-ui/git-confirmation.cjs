'use strict';

// Routine editing, staging and local commits stay immediate. Confirm operations
// that upload work, integrate history, or discard something the user may need.
const actions = {
  'git.push':['Push','Upload commits to the remote repository.'],
  'git.pushTo':['Push','Upload commits to the remote you choose.'],
  'git.pushTags':['Push tags','Upload local tags to the remote repository.'],
  'git.pushForce':['Force push','Replace remote history. Other people’s commits may be lost.'],
  'git.pushForceWithLease':['Force push','Replace remote history if it has not changed.'],
  'git.publish':['Publish','Publish this branch to a remote repository.'],
  'git.sync':['Sync','Pull remote changes and upload your local commits.'],
  'git.syncRebase':['Sync','Rebase on remote changes and upload your local commits.'],
  'git.pull':['Pull','Download and integrate remote changes. Conflicts may need resolution.'],
  'git.pullRebase':['Pull and rebase','Replay your local commits on the remote branch. Conflicts may need resolution.'],
  merge:['Merge','Combine the selected branch with your current branch. Conflicts may need resolution.'],
  abortMerge:['Abort merge','Discard this merge’s resolutions and restore the branch to its previous state.'],
  'git.rebase':['Rebase','Replay your commits on another branch. This changes local history.'],
  'git.rebaseAbort':['Abort rebase','Discard progress on this rebase and restore the previous branch state.'],
  'git.cherryPick':['Cherry-pick','Apply a commit to the current branch. Conflicts may need resolution.'],
  'git.cherryPickRef':['Cherry-pick','Apply the selected commit to the current branch. Conflicts may need resolution.'],
  'git.cherryPickAbort':['Abort cherry-pick','Discard progress on this cherry-pick and restore the previous state.'],
  'git.checkoutDetached':['Check out commit','Leave the current branch and check out a commit in detached HEAD mode.'],
  'git.deleteBranch':['Delete branch','Remove the selected branch label.'],
  'git.deleteTag':['Delete tag','Remove the selected local tag.'],
  'git.removeRemote':['Remove remote','Remove the selected remote connection from this repository.'],
  createGitHub:['Create repository','Create a repository on GitHub with the options you selected. Publishing also uploads committed history.'],
  finishGitHub:['Finish setup','Complete the remote connection and upload committed history if publishing is still pending.'],
  'git.stashDrop':['Drop stash','Delete the selected saved stash.'],
  'git.stashPop':['Pop stash','Apply the saved stash, then remove it if successful. Conflicts may need resolution.'],
  'git.stashApply':['Apply stash','Apply the saved stash to your working files. Conflicts may need resolution.'],
  'git.clean':['Discard','Discard the selected file’s working changes. New files may be deleted.'],
  discardResolution:['Discard','Discard unsaved resolution edits and reload the file from disk.']
};

function gitConfirmation(command, context = {}) {
  const operation = command === 'commit' && context.merging ? ['Finish merge','Commit the staged resolutions and finish this merge.'] : actions[command];
  if (!operation) return;
  const [label,description] = operation;
  const lines = [description];
  if (context.repository) lines.push(`Repository: ${context.repository}`);
  if (context.branch) lines.push(`Branch: ${context.branch}`);
  if (context.source) lines.push(`Source: ${context.source}`);
  if (context.target) lines.push(`Destination: ${context.target}`);
  if (context.file) lines.push(`File: ${context.file}`);
  return {title:`${label}?`,msg:lines.join('\n'),ok:label,cancel:'Cancel'};
}

module.exports = {gitConfirmation};
