/*jslint white:true, nomen:true, plusplus:true, unparam:true, vars:true, bitwise:true */
"use strict";
/**
 * Calculates the CRC32 checksum of a Buffer
 * 
 * From libGlov under the MIT license,
 * http://www.opensource.org/licenses/mit-license.php
**/

var fs = require('fs');
var through = require('through');

/* Table of CRCs of all 8-bit messages. */
var _crc_table = new Array(256);

/* Make the table for a fast CRC. */
(function() {
  var c;
  var n, k;

  for (n = 0; n < 256; n++) {
    c = n;
    for (k = 0; k < 8; k++) {
      if (c & 1) {
        c = -306674912 ^ (c >>> 1);
      } else {
        c = c >>> 1;
      }
    }
    _crc_table[n] = c;
  }
}());


/* Update a running CRC with the bytes buf[0..len-1]--the CRC
should be initialized to all 1's, and the transmitted value
is the 1's complement of the final running CRC (see the
crc() routine below)). */

function update_crc(crc, buf, len)
{
  var c = crc;
  var n;

  for (n = 0; n < len; n++) {
    c = _crc_table[(c ^ buf[n]) & 0xff] ^ (c >>> 8);
  }
  return c;
}

/* Return the CRC of the bytes buf[0..len-1]. */
exports.crc32 = function crc32(buf)
{
  return (update_crc(0xffffffff, buf, buf.length) ^ 0xffffffff);
};

// cb(err, crc32);
exports.crcFileInMem = function (filename, cb) {
  fs.readFile(filename, function (err, data) {
    if (err) {
      return cb(err);
    }
    cb(undefined, exports.crc32(data));
  });
};

// cb(err, crc32);
exports.crcFile = function (filename, cb) {
  var file = fs.createReadStream(filename);
  file.on('error', cb);
  var crc = 0xffffffff;
  var th = through(function write(data) {
    crc = update_crc(crc, data, data.length);
  },
  function end () { //optional
    cb(undefined, crc ^ 0xffffffff);
  });
  file.pipe(th);
};

exports.formatCRC = function (crc) {
  if (crc < 0) {
    crc += 4294967296;
  }
  crc = crc.toString(16);
  while (crc.length < 8) {
    crc = '0' + crc;
  }
  return crc;
};

if (module.parent === null) {
  // Executed crc32.js diretly, work as a command line utility
  if (process.argv.length !== 3) {
    console.log('Expected usage: crc32.js file.ext');
    process.exit();
  } else {
    exports.crcFile(process.argv[2], function (err, crc32) {
      if (err) {
        throw err;
      }
      console.log('CRC32=' + exports.formatCRC(crc32));
    });
  }
}

// TODO: use a native module, this is toooo sloooowwww
