// Synthetic objects only. This executes the patched converter's emitted event
// bodies and real nested snapshot stack, without owned game data or graphics.
#include <cassert>
#include <cstdio>
#include <vector>
#include "child_events.h"
#include "timer_events.h"

class FrameObject { public: int id; explicit FrameObject(int v) : id(v) {} };
class ObjectList {
public:
    std::vector<FrameObject *> all, selected;
    void clear_selection() { selected = all; }
    void select_single(FrameObject * obj) { selected.assign(1, obj); }
    void save_child_selection(ChildEventSelection & state) { state.save(this, selected); }
    void restore_child_selection(const ChildEventSelection & state) {
        const ChildEventSelection::Objects * saved = state.get(this);
        selected = saved ? *saved : all;
    }
};

struct Fixture {
    ChildEventSelection child_event_selection;
    ObjectList a, b;
    FrameObject one, two, three, four;
    bool gate;
    int predicate_calls, parent_actions, child_actions, grandchild_actions, roots;
    Fixture(bool value) : one(1), two(2), three(3), four(4), gate(value),
        predicate_calls(0), parent_actions(0), child_actions(0),
        grandchild_actions(0), roots(0) {
        a.all.push_back(&one); a.all.push_back(&two);
        b.all.push_back(&three); b.all.push_back(&four);
    }
    bool parent_predicate() { ++predicate_calls; return gate; }
    void check_grandchild() {
        ++grandchild_actions;
        assert(a.selected.size() == 1 && a.selected[0]->id == 2);
        assert(b.selected.size() == 2); // inherited through an unsaved type
    }
    void check_sibling() {
        ++child_actions;
        assert(a.selected.size() == 2); // first child's filter must not leak
    }
    // GENERATED_EVENTS
};

struct TimerFixture {
    TimerEvents timers;
    std::vector<int> calls;
    long long now;
    TimerFixture() : now(0) {}
    void schedule_event(int delay, int callback) { timers.schedule(now, delay, callback); }
    void event_callback(int id) {
        calls.push_back(id);
        if (id == 3) schedule_event(0, 4); // included in the current dispatch
    }
    void advance(long long value) { now = value; timers.dispatch(now, this); }
    void generated_schedule() {
        // GENERATED_TIMER
    }
};

int main() {
    Fixture no(false); no.run();
    assert(no.predicate_calls == 1 && no.parent_actions == 0);
    assert(no.child_actions == 0 && no.grandchild_actions == 0 && no.roots == 1);
    assert(no.child_event_selection.stack.empty());
    Fixture yes(true); yes.run();
    assert(yes.predicate_calls == 1 && yes.parent_actions == 1);
    assert(yes.child_actions == 2 && yes.grandchild_actions == 1 && yes.roots == 1);
    assert(yes.child_event_selection.stack.empty());
    // Empty selection is a value, not a request to select all.
    yes.child_event_selection.push();
    yes.a.selected.clear(); yes.a.save_child_selection(yes.child_event_selection);
    yes.a.clear_selection(); yes.a.restore_child_selection(yes.child_event_selection);
    assert(yes.a.selected.empty());
    yes.child_event_selection.pop();
    // Negative control: flattened scheduling violates the false-parent gate.
    Fixture flattened(false); flattened.a.clear_selection(); flattened.b.clear_selection();
    flattened.children_0();
    assert(flattened.child_actions == 2 && flattened.grandchild_actions == 1);
    TimerFixture timer;
    timer.generated_schedule(); // real ScheduleEvent writer: delay200, id7
    timer.schedule_event(50, 2);
    timer.advance(49); assert(timer.calls.empty());
    timer.advance(50); assert(timer.calls.size() == 1 && timer.calls[0] == 2);
    timer.advance(199); assert(timer.calls.size() == 1);
    timer.advance(200); assert(timer.calls.size() == 2 && timer.calls[1] == 7);
    timer.advance(201); assert(timer.calls.size() == 2); // one-shot removal
    timer.schedule_event(0, 3); timer.schedule_event(0, 5);
    timer.advance(201);
    assert(timer.calls.size() == 5 && timer.calls[2] == 3 &&
        timer.calls[3] == 5 && timer.calls[4] == 4); // insertion order
    timer.schedule_event(1, 6); timer.timers.clear(); timer.advance(500);
    assert(timer.calls.size() == 5); // no timers survive a frame reset
    puts("PASS nested child events: predicate, selection, sibling, empty, flattening control (FIXTURE)");
    puts("PASS one-shot timers: deadline, removal, appended-event order, reset (FIXTURE)");
}
