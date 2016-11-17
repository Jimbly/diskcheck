/*jslint indent:2, plusplus:true */
"use strict";

function MultiTask(next) {
  this.next = next;
  this.called_next = false;
  this.dispath_done = false;
  this.count = 0;
}
MultiTask.prototype.dispatchDone = function (next) {
  if (next) {
    this.next = next;
  }
  this.dispatch_done = true;
  if (!this.count && !this.called_next) {
    this.called_next = true;
    this.next();
  }
};
MultiTask.prototype.dispatch = function () {
  this.count++;
  return this.done.bind(this);
};
MultiTask.prototype.done = function (err) {
  if (err && !this.called_next) {
    this.called_next = true;
    this.next(err);
  }
  this.count--;
  if (this.dispatch_done && !this.count && !this.called_next) {
    this.called_next = true;
    this.next();
  }
};

module.exports = MultiTask;