/*jslint white:true, nomen:true, plusplus:true, unparam:true, vars:true, bitwise:true */
"use strict";
/**
 * Calculates the CRC32 checksum of a Buffer
 * 
 * From libGlov under the MIT license,
 * http://www.opensource.org/licenses/mit-license.php
**/

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
