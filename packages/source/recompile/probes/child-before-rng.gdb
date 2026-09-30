# Generated function/line IDs at checkpoint9db9aed, seed24850, officeframe3.
set pagination off
set confirm off
break events_13.cpp:2061
commands
silent
printf "DRAW event=735 range=100 loop=%d draws=%u state=%u\n", manager.frame->loop_count, fusion_draws, fusion_graine
continue
end
break events_4.cpp:677
commands
silent
printf "DRAW event=53 range=50 loop=%d draws=%u state=%u\n", manager.frame->loop_count, fusion_draws, fusion_graine
continue
end
break events_5.cpp:610
commands
silent
printf "DRAW event=157 range=31 loop=%d draws=%u state=%u\n", manager.frame->loop_count, fusion_draws, fusion_graine
continue
end
break Frames::event_func_938 if manager.frame->index == 3 && manager.frame->loop_count < 2
commands
silent
printf "IMAGE loop=%d viewing=%g guard=%d\n", manager.frame->loop_count, ((Counter*)instances.items[53].back_obj)->value, this->not_always_724_3
continue
end
run
