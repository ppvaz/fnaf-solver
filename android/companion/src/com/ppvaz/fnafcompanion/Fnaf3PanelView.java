package com.ppvaz.fnafcompanion;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.view.View;

import java.util.Locale;

/**
 * Draws the FNaF 3 teach panel in the band above the monitor.
 *
 * <p>Its visual language is the pursuit, not a clock: FNaF 1's bars are keyed
 * to each character's tick, FNaF 2's ring to a timed cycle, FNaF 4's map to a
 * walk between stations. FNaF 3's player never moves -- the adversary does --
 * so the panel is a miniature of the game's own camera and vent map, placed as
 * the monitor places its labels, with:</p>
 * <ul>
 * <li>where Springtrap was <b>last seen</b> (filled in his olive, fading as
 *     the sighting ages), the camera <b>on screen</b> outlined, the
 *     <b>sealed vent</b> with the game's red bar, and the last <b>lure</b>;</li>
 * <li>the <b>step</b>, why, and his clock: the 1 s counter tick and how often
 *     he moves on average at this night's AI;</li>
 * <li>the three <b>systems</b> as the maintenance panel lists them.</li>
 * </ul>
 * <p>Olive means Springtrap, blue a vent, and one red means danger -- nothing
 * else uses it.</p>
 *
 * <p>Every pixel of the window is painted opaque in the panel palette, and
 * the window is exactly {@link Fnaf3Lesson}'s rectangle, which the FNaF 3
 * native regions clear; the platform composites it at its 0.8 overlay cap.</p>
 */
public final class Fnaf3PanelView extends View {
    private static final int FILL = 0xFF060807;
    private static final int INK_TEXT = 0xFFF2F2EE;
    private static final int INK_DIM = 0xFF969EAA;
    private static final int INK_FAINT = 0xFF3A3F46;
    private static final int INK_TRACK = 0xFF1C1E22;
    private static final int INK_SPRINGTRAP = 0xFFA8B84A;
    private static final int INK_VENT = 0xFF4A86D8;
    private static final int INK_LURE = 0xFFE8B730;
    private static final int INK_SAFE = 0xFF4FC7A0;
    private static final int INK_ALERT = 0xFFFF3B3B;

    /**
     * The monitor's label centres in native pixels (controls-fnaf3-moto-g56-v204.json):
     * cameras 1-10, then vents 11-15, then the office.
     */
    private static final int[][] NODE = {
        null,
        {1566, 950}, {2071, 912}, {2261, 852}, {2261, 761}, {1876, 782},
        {1550, 794}, {1550, 701}, {1796, 670}, {1952, 610}, {2206, 660},
        {1560, 571}, {1704, 737}, {1903, 821}, {2104, 708}, {2160, 906},
    };
    private static final int[] OFFICE = {1862, 942};
    private static final float MAP_X0 = 1530;
    private static final float MAP_Y0 = 556;
    private static final float MAP_SCALE = 0.26f;

    private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint stroke = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint title = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint body = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint small = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Fnaf3Lesson lesson;

    public Fnaf3PanelView(Context context, Fnaf3Lesson lesson) {
        super(context);
        this.lesson = lesson;
        setFocusable(false);
        setClickable(false);
        setWillNotDraw(false);
        fill.setStyle(Paint.Style.FILL);
        stroke.setStyle(Paint.Style.STROKE);
        Typeface hud = loadHudTypeface(context);
        title.setTypeface(hud);
        title.setTextSize(26f);
        body.setTypeface(hud);
        body.setTextSize(19f);
        small.setTypeface(Typeface.DEFAULT);
        small.setTextSize(17f);
        setContentDescription("FNaF 3 teach panel");
    }

    private static Typeface loadHudTypeface(Context context) {
        try {
            return Typeface.createFromAsset(context.getAssets(), "fonts/hud-font.otf");
        } catch (RuntimeException unavailable) {
            return Typeface.create(Typeface.MONOSPACE, Typeface.NORMAL);
        }
    }

    @Override
    protected void onDraw(Canvas canvas) {
        int w = getWidth();
        fill.setColor(FILL);
        canvas.drawRect(0, 0, w, getHeight(), fill);
        long now = System.nanoTime();
        long night = lesson.nightMs(now);
        Fnaf3Lesson.Step step = lesson.step();

        map(canvas, 10, 6, now);

        float x = 230;
        title.setColor(step == Fnaf3Lesson.Step.PHANTOM ? INK_ALERT : INK_TEXT);
        canvas.drawText(Fnaf3Lesson.hour(Math.max(0, night), Math.max(1, lesson.night())) + "  " + step.title, x, 30, title);
        small.setColor(INK_DIM);
        canvas.drawText(step.why, x, 54, small);
        sighting(canvas, x, 80, now);
        tick(canvas, x, 90, 1000, night);

        systems(canvas, 1250, 8);
        postInvalidateOnAnimation();
    }

    private float nx(int n) { return (NODE[n][0] - MAP_X0) * MAP_SCALE; }
    private float ny(int n) { return (NODE[n][1] - MAP_Y0) * MAP_SCALE; }

    /** The building as the monitor draws it: cameras grey, vents blue, the office below. */
    private void map(Canvas canvas, float ox, float oy, long now) {
        int look = lesson.look();
        int seen = lesson.seen();
        int sealed = lesson.sealed();
        int lure = lesson.lure();
        long seenAgo = lesson.seenAgoMs(now);
        fill.setColor(INK_FAINT);
        float offx = ox + (OFFICE[0] - MAP_X0) * MAP_SCALE;
        float offy = oy + (OFFICE[1] - MAP_Y0) * MAP_SCALE;
        canvas.drawRect(offx - 16, offy - 7, offx + 16, offy + 7, fill);
        small.setColor(INK_DIM);
        for (int n = 1; n <= 15; n++) {
            float cx = ox + nx(n);
            float cy = oy + ny(n);
            boolean vent = n >= 11;
            int ink = vent ? INK_VENT : INK_FAINT;
            if (n == seen && seenAgo >= 0) {
                // A sighting fades over 10 s: after that it is a guess, not a reading.
                float fresh = Math.max(0.25f, 1f - seenAgo / 10000f);
                ink = blend(INK_SPRINGTRAP, FILL, fresh);
            }
            fill.setColor(ink);
            canvas.drawRect(cx - 14, cy - 6, cx + 14, cy + 6, fill);
            if (vent && n == sealed) {
                fill.setColor(INK_ALERT);
                canvas.drawRect(cx - 14, cy + 7, cx + 14, cy + 11, fill);
            }
            if (n == look) {
                stroke.setColor(INK_TEXT);
                stroke.setStrokeWidth(2.5f);
                canvas.drawRect(cx - 16, cy - 8, cx + 16, cy + 8, stroke);
            }
            if (n == lure && lesson.lureAgoMs(now) >= 0 && lesson.lureAgoMs(now) < 6000) {
                stroke.setColor(INK_LURE);
                stroke.setStrokeWidth(2f);
                canvas.drawCircle(cx, cy, 12 + (lesson.lureAgoMs(now) % 1000) / 90f, stroke);
            }
        }
    }

    private static int blend(int a, int b, float t) {
        int ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
        int br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
        return 0xFF000000 | (Math.round(br + (ar - br) * t) << 16)
                | (Math.round(bg + (ag - bg) * t) << 8) | Math.round(bb + (ab - bb) * t);
    }

    /** Where he was last seen, how long ago, and the vent that camera leads into. */
    private void sighting(Canvas canvas, float x, float y, long now) {
        int seen = lesson.seen();
        long ago = lesson.seenAgoMs(now);
        String text;
        int ink = INK_DIM;
        if (seen == 0 || ago < 0) {
            text = "Not seen yet";
        } else {
            int vent = seen <= 10 ? Fnaf3Lesson.ventFrom(seen) : 0;
            text = String.format(Locale.ROOT, "Last seen %s  %.1f s ago", Fnaf3Lesson.cam(seen), ago / 1000f);
            if (seen >= 11) {
                text += Fnaf3Lesson.lethal(seen) ? "  IN A VENT: one move from the office" : "  in a vent";
                ink = INK_ALERT;
            } else if (vent != 0) {
                text += String.format(Locale.ROOT, "  next to vent %d%s", vent,
                        lesson.sealed() == vent ? " (sealed)" : Fnaf3Lesson.lethal(vent) ? " (straight in)" : "");
                ink = lesson.sealed() == vent ? INK_SAFE : Fnaf3Lesson.lethal(vent) ? INK_ALERT : INK_SPRINGTRAP;
            } else {
                ink = INK_SPRINGTRAP;
            }
        }
        body.setColor(ink);
        canvas.drawText(text, x, y, body);
    }

    /** His counter's tick, and the mean gap between moves at this night's AI. */
    private void tick(Canvas canvas, float x, float y, float width, long night) {
        int n = lesson.night();
        if (n == 0) return;
        boolean aggressive = lesson.aggressive();
        String text = String.format(Locale.ROOT, "AI %d%s: he moves every %.1f s on average; his counter ticks",
                Fnaf3Lesson.ai(n), aggressive ? " (Aggressive)" : "",
                Fnaf3Lesson.meanMoveS(Fnaf3Lesson.ai(n), aggressive));
        small.setColor(INK_DIM);
        canvas.drawText(text, x, y + 16, small);
        // The counter gains one a second (two under Aggressive, g222), on the night's own clock.
        float bx = x + small.measureText(text) + 12;
        float bw = Math.min(160, width - (bx - x));
        float done = (float) Fnaf3Lesson.phase(Math.max(0, night), Fnaf3Lesson.TICK_MS);
        fill.setColor(INK_TRACK);
        canvas.drawRect(bx, y + 4, bx + bw, y + 16, fill);
        fill.setColor(INK_SPRINGTRAP);
        canvas.drawRect(bx, y + 4, bx + bw * done, y + 16, fill);
    }

    /** Audio, camera, ventilation, as the maintenance panel lists them. */
    private void systems(Canvas canvas, float x, float y) {
        String[] names = { "AUDIO", "CAMERA", "VENT" };
        int sight = lesson.sightS();
        int lures = lesson.luresLeft();
        String[] need = {
            lures >= 0 ? String.format(Locale.ROOT, "%d lure%s left", lures, lures == 1 ? "" : "s") : "no lure without it",
            sight >= 0 ? String.format(Locale.ROOT, "fails in %d s of looking", sight) : "no sighting without it",
            "the one that lets him in" };
        for (Fnaf3Lesson.System3 which : Fnaf3Lesson.System3.values()) {
            int i = which.ordinal();
            float ry = y + i * 34;
            Fnaf3Lesson.Sys state = lesson.sys(which);
            int ink = state == Fnaf3Lesson.Sys.ERROR ? INK_ALERT : state == Fnaf3Lesson.Sys.REBOOT ? INK_LURE : INK_SAFE;
            fill.setColor(ink);
            canvas.drawRect(x, ry + 4, x + 14, ry + 22, fill);
            body.setColor(INK_TEXT);
            canvas.drawText(names[i], x + 24, ry + 21, body);
            body.setColor(ink);
            canvas.drawText(Fnaf3Lesson.word(state), x + 150, ry + 21, body);
            small.setColor(INK_DIM);
            canvas.drawText(need[i], x + 290, ry + 20, small);
        }
    }
}
