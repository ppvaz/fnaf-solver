# Generated function IDs at checkpoint9db9aed.
set pagination off
set confirm off
break Frames::event_func_243 if manager.frame->index == 3 && manager.frame->loop_count == 0
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
continue
