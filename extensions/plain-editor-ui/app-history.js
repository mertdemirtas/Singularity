'use strict';

class AppHistory {
  constructor() { this.entries = []; this.index = -1; }
  visit(id) {
    if (!id || this.entries[this.index] === id) return;
    this.entries.splice(this.index + 1);
    this.entries.push(id);
    if (this.entries.length > 100) this.entries.shift();
    this.index = this.entries.length - 1;
  }
  remove(id) {
    const current = this.index;
    this.index = -1;
    this.entries = this.entries.filter((entry, index) => {
      if (entry === id) return false;
      if (index <= current) this.index++;
      return true;
    });
  }
  find(direction, available) {
    for (let index = this.index + direction; index >= 0 && index < this.entries.length; index += direction) {
      if (this.entries[index] !== this.entries[this.index] && available(this.entries[index])) return index;
    }
    return -1;
  }
  canGo(direction, available) { return this.find(direction, available) !== -1; }
  go(direction, available) {
    const next = this.find(direction, available);
    if (next === -1) return undefined;
    this.index = next;
    return this.entries[next];
  }
}
module.exports = AppHistory;
