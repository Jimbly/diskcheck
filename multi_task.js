/*jslint indent:2, plusplus:true */
"use strict";

function MultiTask(next) {
  this.next = next;
  this.dispath_done = false;
  this.count = 0;
}
MultiTask.prototype.dispatchDone = function (next) {
  if (next) {
    this.next = next;
  }
  this.dispatch_done = true;
  if (!this.count) {
    this.next();
  }
};
MultiTask.prototype.dispatch = function () {
  this.count++;
};
MultiTask.prototype.done = function () {
  this.count--;
  if (this.dispatch_done && !this.count) {
    this.next();
  }
};

module.exports = MultiTask;