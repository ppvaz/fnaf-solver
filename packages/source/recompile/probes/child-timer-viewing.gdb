# Generated function IDs for the child+one-shot-timer patch, build296 CCN hash
# recorded by results/child-event-diagnosis-20260927.json; 64office updates.
set pagination off
set confirm off
break Frames::handle_frame_4_events if manager.frame->loop_count == 0
run
set $viewing = (Counter*)manager.frame->instances.items[53].back_obj
printf "INITIAL viewing=%g\n", $viewing->value
watch -l $viewing->value
commands
silent
printf "VIEWING_WRITE loop=%d value=%g\n", manager.frame->loop_count, $viewing->value
bt 3
continue
end
break Frames::event_func_983 if manager.frame->loop_count < 2
commands
silent
printf "IMAGE loop=%d viewing=%g guard=%d\n", manager.frame->loop_count, $viewing->value, this->not_always_713_3
continue
end
break Frames::handle_frame_4_events if manager.frame->loop_count == 63
commands
silent
printf "FINAL viewing=%g loop=%d\n", $viewing->value, manager.frame->loop_count
continue
end
continue
