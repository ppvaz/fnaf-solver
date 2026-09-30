#!/usr/bin/env python
"""Execute synthetic nested rows through patched Chowdren's real code emitter.

PYTHONPATH=<patched-anaconda>:<patched-anaconda>/Chowdren <python2.7> \
  packages/source/recompile/test-child-events.py
Requires a C++ compiler (CXX, default c++). No CCN/assets/device are read.
"""
from __future__ import print_function
import os
import shutil
import subprocess
import tempfile
from collections import defaultdict
from chowdren.child_events import partition_child_events
from chowdren.converter import Converter, EventGroup
from chowdren.codewriter import CodeWriter
from chowdren.writers.events import ActionWriter, ConditionWriter
from chowdren.writers.events.system import (ChildEvents, ChildEventsCondition,
    ScheduleEvent, static_timer_name)


class Value(object):
    def __init__(self, **kw):
        self.__dict__.update(kw)


class Flags(dict):
    def __init__(self, bits):
        dict.__init__(self, Always=True)
        self.bits = bits

    def getFlags(self):
        return self.bits


def ace(num, handles=()):
    return Value(objectType=-1, num=num, flags=Flags(0),
                 items=[Value(loader=Value(objectInfos=
                     [word for handle in handles for word in (handle, 0)]))])


def row(flags=0, children=False, end=False):
    return Value(flags=Flags(flags), conditions=[ace(-42 if end else -1)],
                 actions=[ace(43)] if children else [])


rows = [row(0x40, True), row(0x8040, True), row(0x8000), row(end=True),
        row(0x8000), row(end=True), row()]
roots, children = partition_child_events(rows)
assert roots == [0, 6] and children == {0: [1, 4], 1: [2]}
for bad in ([row(end=True)], [row(0x40, True)], [row(0x8000)],
            [row(children=True)], [row(0x40)]):
    try:
        partition_child_events(bad)
    except ValueError:
        pass
    else:
        raise AssertionError('malformed child boundary accepted')
triggered = row(0x8000)
triggered.conditions[0].flags['Always'] = False
try:
    partition_child_events([row(0x40, True), triggered, row(end=True)])
except NotImplementedError:
    pass
else:
    raise AssertionError('unsupported triggered child flattened')


class Config(object):
    def use_simple_or(self):
        return True

    def write_pre(self, writer, group):
        pass


class ProbeConverter(Converter):
    def __init__(self):
        self.config = Config()
        self.use_dlls = False
        self.event_functions = {}
        self.event_frame_initializers = defaultdict(list)
        self.frame_initializers = {}
        self.multiple_instances = set([(1, 2), (2, 2)])
        self.current_frame_index = 0
        self.collision_objects = set()
        self.clear_selection()
        self.set_iterator(None)

    def filter_object_type(self, obj):
        return obj[0], 2

    def resolve_qualifier(self, obj):
        return [obj]

    def get_object_list(self, obj):
        return {1: 'a', 2: 'b'}[obj[0]]

    def is_static_backdrop_list(self, name):
        return False


class Condition(ConditionWriter):
    custom = True

    def __init__(self, converter, code, selects=()):
        self.converter, self.code, self.selects = converter, code, selects

    def write(self, writer):
        writer.putln(self.code.replace('BREAK', self.converter.event_break))
        for handle in self.selects:
            obj = (handle, 2)
            self.converter.set_list(obj, self.converter.get_object_list(obj))


class Action(ActionWriter):
    custom = True

    def __init__(self, code):
        self.code = code

    def write(self, writer):
        writer.putln(self.code)


c = ProbeConverter()


def capture(index, handles):
    action = ChildEvents(c, ace(43, handles))
    action.child_method = 'children_%s' % index
    return action


def restore(handles):
    return ChildEventsCondition(c, ace(-43, handles))


specs = {
    0: ([Condition(c, 'if (!parent_predicate()) BREAK'),
         Condition(c, 'a.clear_selection(); b.clear_selection();', (1, 2))],
        [Action('++parent_actions;'), capture(0, (1, 2))]),
    1: ([restore((1, 2)), Condition(c, 'a.selected.erase(a.selected.begin());', (1,))],
        [Action('++child_actions;'), capture(1, (1,))]),
    2: ([restore((1, 2))], [Action('check_grandchild();')]),
    4: ([restore((1,))], [Action('check_sibling();')]),
    6: ([Condition(c, '')], [Action('++roots;')]),
}
out = CodeWriter()
groups = {}
for index in sorted(specs):
    conditions, actions = specs[index]
    group = EventGroup(c, conditions, actions, None, index + 1, 0, None, None)
    groups[index] = group
    c.write_event_function(out, [group])
for parent in sorted(children):
    out.putmeth('void children_%s' % parent)
    for index in children[parent]:
        out.putlnc('%s();', groups[index].event_name)
    out.end_brace()
out.putmeth('void run')
for index in roots:
    out.putlnc('%s();', groups[index].event_name)
out.end_brace()

here = os.path.dirname(os.path.abspath(__file__))
template = open(os.path.join(here, 'fixtures', 'child-events.cpp')).read()
source = template.replace('// GENERATED_EVENTS', out.get_data())
c.convert_static_expression = lambda items: items
c.convert_parameter = lambda parameter: parameter.loader.timer
c.system_object = Value(timer_event_ids={'gate': 7})
timer_name = Value(loader=Value(items='GaTe'))
assert static_timer_name(c, timer_name) == 'gate'
for bad in (None, u'\u03a9'):
    try:
        static_timer_name(c, Value(loader=Value(items=bad)))
    except NotImplementedError:
        pass
    else:
        raise AssertionError('unsupported timer name was accepted')
timer_writer = CodeWriter()
ScheduleEvent(c, Value(items=[Value(loader=Value(timer=200)), timer_name])).write(timer_writer)
assert timer_writer.get_data().strip() == 'schedule_event(int(200), 7);'
source = source.replace('// GENERATED_TIMER', timer_writer.get_data())
import chowdren
base = os.path.join(os.path.dirname(chowdren.__file__), '..', 'base')
temporary = tempfile.mkdtemp(prefix='chowdren-child-test-')
try:
    binary = os.path.join(temporary, 'fixture')
    compiler = subprocess.Popen([os.environ.get('CXX', 'c++'), '-std=c++11',
        '-Wall', '-Wextra', '-I', base, '-x', 'c++', '-', '-o', binary],
        stdin=subprocess.PIPE)
    compiler.communicate(source)
    assert compiler.returncode == 0, 'synthetic generated C++ failed to compile'
    subprocess.check_call([binary])
finally:
    shutil.rmtree(temporary)
print('PASS child partition: nested boundaries and malformed/trigger refusal (FIXTURE)')
