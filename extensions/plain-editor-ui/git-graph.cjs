'use strict';

// Topological Git order guarantees a parent is below its children. Retain
// pending parents in stable lanes, sharing a lane when histories converge.
function layoutGraph(commits) {
  let lanes = [], width = 1;
  const rows = [], edges = [];
  for (let row = 0; row < commits.length; row++) {
    const commit = commits[row];
    let lane = lanes.indexOf(commit.id);
    if (lane === -1) { lane = lanes.indexOf(null); if (lane === -1) lane = lanes.length; lanes[lane] = commit.id; }
    width = Math.max(width, lanes.length);
    const next = lanes.slice(); next[lane] = null;
    for (let column = 0; column < lanes.length; column++) {
      if (column !== lane && lanes[column]) edges.push({ row, from: column, to: column, color: column });
    }
    for (const parent of new Set(commit.parents)) {
      let column = next.indexOf(parent);
      if (column === -1) { column = next.indexOf(null); if (column === -1) column = next.length; next[column] = parent; }
      edges.push({ row, from: lane, to: column, color: column });
    }
    rows.push({ ...commit, lane }); width = Math.max(width, next.length);
    while (next.at(-1) === null) next.pop();
    lanes = next;
  }
  return { rows, edges, width };
}

module.exports = { layoutGraph };
