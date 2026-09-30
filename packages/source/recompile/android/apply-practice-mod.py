#!/usr/bin/env python3
"""Add the first read-only practice layer to a private generated FNaF 2 build.

The input tree is a copy of Chowdren's generated game source. It must remain
outside the repository because it is derived from the owned game CCN.
"""

from __future__ import annotations

import argparse
from pathlib import Path
import re


MARKER = "// FNAF2_PRACTICE_MOD_V1"
INCLUDES = '#include "bitarray.h"\n'
HANDLER = re.compile(
    r"(void Frames::handle_frame_4_events\(\)\s*\{.*?)(\n\}\nvoid Frames::handle_frame_4_pre_events\(\))",
    re.DOTALL,
)

HOOK = r'''    // FNAF2_PRACTICE_MOD_V2: read-only encounter trace and accepted input edges.
    if (index == 3) {
        static bool previous_left_button = false;
        static unsigned long long practice_update = 0;
        static FILE *state_log = NULL;
        ++practice_update;

        FrameObject *hud_object = get_instance(olivierdebugstring_9_instances);
        if (hud_object != NULL) {
            Text *hud = static_cast<Text*>(hud_object);
            hud->set_visible(true);
            hud->set_x(18);
            hud->set_y(24);
            hud->width = 620;
            hud->height = 210;
            hud->set_layer(8);
            hud->move_front();

            Counter *camera = static_cast<Counter*>(get_instance(viewing_55_instances));
            Active *mask = static_cast<Active*>(get_instance(mask_89_instances));
            Counter *danger = static_cast<Counter*>(get_instance(indanger_125_instances));
            Active *music_button = static_cast<Active*>(get_instance(musicbutton_145_instances));
            Counter *battery = static_cast<Counter*>(get_instance(batterylife_92_instances));
            Counter *your_view = static_cast<Counter*>(get_instance(yourview_126_instances));
            Counter *blackout = static_cast<Counter*>(get_instance(blackout_131_instances));
            Counter *time_left = static_cast<Counter*>(get_instance(timeleft_133_instances));
            Counter *got_you = static_cast<Counter*>(get_instance(gotyoustage_134_instances));
            Counter *drop_everything = static_cast<Counter*>(get_instance(dropeverything_141_instances));
            Counter *office_occupied = static_cast<Counter*>(get_instance(officeoccupied_150_instances));
            Counter *golden = static_cast<Counter*>(get_instance(golden_156_instances));
            const double camera_value = camera ? camera->value : -1.0;
            const double mask_v0 = (mask && mask->alterables) ? mask->alterables->values.get(0) : -1.0;
            const double danger_value = danger ? danger->value : -1.0;
            const double music_fill_v0 = (music_button && music_button->alterables)
                ? music_button->alterables->values.get(0) : -1.0;
            const double battery_value = battery ? battery->value : -1.0;

            char display[512];
            std::snprintf(display, sizeof(display),
                "FNAF 2 PRACTICE / REBUILT RUNTIME\n"
                "camera %.0f  view %.0f  mask %.0f  danger %.0f\n"
                "music %.2f  battery %.2f  blackout %.0f  time %.0f\n"
                "read-only; state: practice-state.jsonl",
                camera_value, your_view ? your_view->value : -1.0, mask_v0,
                danger_value, music_fill_v0, battery_value,
                blackout ? blackout->value : -1.0, time_left ? time_left->value : -1.0);
            hud->set_string(display);

            if (state_log == NULL)
                state_log = std::fopen("practice-state.jsonl", "a");
            if (state_log != NULL) {
                std::fprintf(state_log,
                    "{\"schema\":\"fnaf2-practice-state-v1\",\"update\":%llu,"
                    "\"elapsed_ms\":%llu,\"frame\":%d,\"tick\":%d,"
                    "\"rng_draws\":%u,\"rng_state\":%u,"
                    "\"office\":{\"camera\":%.3f,\"view\":%.3f,\"mask\":%.3f,"
                    "\"danger\":%.3f,\"blackout\":%.3f,\"time_left\":%.3f,"
                    "\"got_you\":%.3f,\"drop_everything\":%.3f,\"occupied\":%.3f,"
                    "\"golden\":%.3f,\"music_fill\":%.3f,\"battery\":%.3f},"
                    "\"actors\":[",
                    practice_update, static_cast<unsigned long long>(SDL_GetTicks64()), index,
                    harness_tick(), fusion_draws, fusion_graine,
                    camera_value, your_view ? your_view->value : -1.0,
                    mask_v0, danger_value, blackout ? blackout->value : -1.0,
                    time_left ? time_left->value : -1.0, got_you ? got_you->value : -1.0,
                    drop_everything ? drop_everything->value : -1.0,
                    office_occupied ? office_occupied->value : -1.0,
                    golden ? golden->value : -1.0, music_fill_v0, battery_value);
                bool first_actor = true;
                const char *actor_names[] = {"oldbonnie", "oldchica", "oldfreddy", "newbonnie",
                    "newchica", "newfreddy", "balloonboy", "sockpuppet", "newfoxy", "oldfoxy"};
                FrameObject *actor_objects[] = {get_instance(oldbonnie_96_instances), get_instance(oldchica_97_instances),
                    get_instance(oldfreddy_98_instances), get_instance(newbonnie_99_instances),
                    get_instance(newchica_100_instances), get_instance(newfreddy_101_instances),
                    get_instance(balloonboy_102_instances), get_instance(sockpuppet_103_instances),
                    get_instance(newfoxy_104_instances), get_instance(oldfoxy_105_instances)};
                for (unsigned int actor_index = 0; actor_index < 10; ++actor_index) {
                    FrameObject *object = actor_objects[actor_index];
                    if (object == NULL) continue;
                    Active *active = static_cast<Active*>(object);
                    if (!first_actor) std::fputc(',', state_log);
                    first_actor = false;
                    const double v0 = active->alterables ? active->alterables->values.get(0) : -1.0;
                    const double v1 = active->alterables ? active->alterables->values.get(1) : -1.0;
                    std::fprintf(state_log,
                        "{\"name\":\"%s\",\"x\":%d,\"y\":%d,\"animation\":%d,"
                        "\"frame\":%d,\"direction\":%d,\"v0\":%.3f,\"v1\":%.3f}",
                        actor_names[actor_index], object->x, object->y, active->current_animation,
                        active->animation_frame, active->animation_direction, v0, v1);
                }
                std::fputs("]}\n", state_log);
                if ((practice_update % 60) == 0) std::fflush(state_log);
            }
        }

        const bool left_button = manager.mouse.is_pressed(SDL_BUTTON_LEFT);
        if (left_button != previous_left_button) {
            int input_x = 0;
            int input_y = 0;
            get_mouse_pos(&input_x, &input_y);
            FILE *input_log = std::fopen("practice-input.jsonl", "a");
            if (input_log != NULL) {
                std::fprintf(input_log,
                    "{\"event\":\"sdl-left-button-state-edge\",\"edge\":\"%s\","
                    "\"elapsed_ms\":%llu,\"frame\":%d,\"update\":%llu,"
                    "\"x\":%d,\"y\":%d}\n",
                    left_button ? "down" : "up",
                    static_cast<unsigned long long>(SDL_GetTicks64()), index,
                    practice_update, input_x, input_y);
                std::fclose(input_log);
            }
        }
        previous_left_button = left_button;
    }
'''


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gamesrc", required=True, type=Path,
                        help="private generated gamesrc copy, outside the repository")
    args = parser.parse_args()
    source = args.gamesrc / "events_14.cpp"
    if not source.is_file():
        raise SystemExit(f"missing generated office event source: {source}")
    text = source.read_text()
    if MARKER in text:
        print(f"practice layer already present: {source}")
        return
    if INCLUDES not in text:
        raise SystemExit("generated event source no longer has the expected include anchor")
    match = HANDLER.search(text)
    if not match:
        raise SystemExit("generated office event handler no longer has the expected anchor")

    text = text.replace(INCLUDES, INCLUDES + "#include <cstdio>\n#include <SDL.h>\n#include \"harness.h\"\n", 1)
    match = HANDLER.search(text)
    assert match is not None
    text = text[:match.start(2)] + "\n" + HOOK + text[match.start(2):]
    source.write_text(text)
    print(f"enabled read-only practice HUD and input edge log: {source}")


if __name__ == "__main__":
    main()
