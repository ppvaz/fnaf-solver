#!/usr/bin/env python3
"""Phone-free tests for the mandatory actuation UNKNOWN metric."""

import importlib.util
import json
import pathlib
import sys
import tempfile
import unittest


HERE = pathlib.Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("actuation_metric", HERE / "actuation-frame-metric.py")
metric = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = metric
SPEC.loader.exec_module(metric)


def cells_for(monitor, mask, ambiguous=False):
    cells = [0x141414] * metric.GRID_CELLS
    monitor_values = {
        112: 170 if monitor else 0,
        131: 53 if monitor else 0,
        132: 170 if monitor else 0,
        151: 53 if monitor else 0,
        165: 0 if monitor else 187,
        167: 0 if monitor else 187,
    }
    mask_values = {1: 0 if mask else 194,
                   18: 0 if mask else 148,
                   154: 0 if mask else 143,
                   172: 0 if mask else 216,
                   174: 0 if mask else 228,
                   175: 0 if mask else 194}
    for index, value in {**monitor_values, **mask_values}.items():
        cells[index] = value << 16 | value << 8 | value
    if ambiguous:
        cells[112] = 120 << 16 | 120 << 8 | 120
    return cells


class MetricTest(unittest.TestCase):
    def test_positive_complement_is_known_but_negative_is_not_inference(self):
        self.assertEqual(metric.reconcile(metric.State(True), metric.State(None)).value, True)
        self.assertEqual(metric.reconcile(metric.State(True), metric.State(None)).reason,
                         "mask-off-monitor-complement")
        self.assertIsNone(metric.reconcile(metric.State(False), metric.State(None)).value)
        self.assertIsNone(metric.reconcile(metric.State(None), metric.State(False)).value)

    def test_contradiction_is_unknown(self):
        state = metric.reconcile(metric.State(True), metric.State(True))
        self.assertIsNone(state.value)
        self.assertEqual(state.reason, "mask-monitor-contradiction")

    def test_native_trace_report_counts_combined_unknown_frames(self):
        with tempfile.TemporaryDirectory() as temp:
            trace = pathlib.Path(temp) / "trace.tsv"
            rows = []
            for sequence, cells in enumerate([
                    cells_for(False, False),
                    cells_for(True, False),
                    cells_for(False, False, ambiguous=True)], 1):
                grid = "".join(f"{cell:06x}" for cell in cells)
                rows.append("\t".join(map(str, [sequence, sequence * 1000000,
                    sequence * 1000000, 16666666, 20, 0, 40, 100, grid])))
            trace.write_text(
                "# schema=fnaf2-frame-trace-v1 clock=helper-monotonic-ns "
                "start_ns=1000000 label=test\n"
                "seq\timage_ns\tcallback_ns\tinterval_ns\tgrid_mean_luma\t"
                "screen_identity\tmask_luma\tmonitor_luma\tgrid_hex\n" +
                "\n".join(rows) + "\n")
            result = metric.report(trace)
            self.assertEqual(result["frames"], 3)
            self.assertEqual(result["combined"]["knownFrames"], 2)
            self.assertEqual(result["combined"]["unknownFrames"], 1)
            self.assertEqual(result["unknown_frame_pct"], 33.333)

    def test_native_strokes_override_grid_and_report_basis(self):
        with tempfile.TemporaryDirectory() as temp:
            trace = pathlib.Path(temp) / "trace-v3.tsv"
            grid = "".join(f"{cell:06x}" for cell in cells_for(False, False))
            rows = [
                [1, 1000000, 1000000, 1000000, 0, 0, 0, 0, 141, 140, grid],
                [2, 2000000, 2000000, 2000000, 0, 0, 0, 0, 0, 140, grid],
                [3, 3000000, 3000000, 3000000, 0, 0, 0, 0, 60, 80, grid],
            ]
            trace.write_text(
                "# schema=fnaf2-frame-trace-v3 clock=helper-monotonic-ns "
                "start_ns=1000000 label=test\n"
                "seq\timage_ns\tcallback_ns\tinterval_ns\tgrid_mean_luma\t"
                "screen_identity\tmask_luma\tmonitor_luma\tmask_downstroke\t"
                "monitor_downstroke\tgrid_hex\n" +
                "\n".join("\t".join(map(str, row)) for row in rows) + "\n")
            result = metric.report(trace)
            self.assertEqual(result["basis"], "native-strokes")
            self.assertEqual(result["monitor"]["unknownFrames"], 1)
            self.assertEqual(result["mask"]["unknownFrames"], 1)
            self.assertEqual(result["combined"]["unknownFrames"], 1)


if __name__ == "__main__":
    result = unittest.main(exit=False, verbosity=0).result
    if not result.wasSuccessful():
        raise SystemExit(1)
    print("actuation frame metric: native unknown-frame percentage and safe complements pass")
