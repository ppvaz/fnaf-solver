#!/usr/bin/env python
"""Synthetic parser regressions; no owned input is read.

PYTHONPATH=<patched-anaconda> <python2.7> packages/source/recompile/test-mobile-parser.py
Rebuild that checkout's Cython modules first. Claim ceiling: FIXTURE.
"""
from __future__ import print_function
import struct
from mmfparser.bytereader import ByteReader
from mmfparser.data.chunkloaders.expressions.loaders import Double
from mmfparser.data.chunkloaders.objectinfo import ObjectHeader
from mmfparser.data.chunkloaders.frame import ObjectInstance

checks = 0
for value in (0, 4.25, -4.25, 0.5, -0.5, 65536.125):
    reader = ByteReader(struct.pack('<q', int(value * 2**32)) + b'NEXT')
    parsed = Double(reader, build=296)
    assert parsed.value == value, (value, parsed.value)
    assert reader.tell() == 8
    checks += 1
for settings in ({'build': 283}, {'build': 296, 'compat': True}):
    reader = ByteReader(struct.pack('<df', 4.25, 4.25) + b'NEXT')
    parsed = Double(reader, **settings)
    assert parsed.value == 4.25 and reader.tell() == 12
    checks += 1
for handle in (0, 15, 16, 37, 257):
    header = ObjectHeader(ByteReader(struct.pack('<hhhhII', handle ^ 28, 2, 0, 0, 0, 0)), build=296)
    instance = ObjectInstance(ByteReader(struct.pack('<HHii hhhh', 1, handle ^ 48, 0, 0, 2, handle ^ 48, 0, 0)), build=296)
    assert header.handle == instance.objectInfo == instance.parentHandle == handle
    checks += 1
print('PASS mobile parser: %d synthetic fixed-point/legacy/handle checks (FIXTURE)' % checks)
