package com.ppvaz.fnafcompanion;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.view.View;

/** The FNaF 1 Night 1 and 2 teaching strip ({@link Fnaf1Strip}); input never reaches it. */
final class Fnaf1StripView extends View {
    private final Fnaf1Strip strip;
    private final Paint fill = new Paint();
    private final Paint headline = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint body = new Paint(Paint.ANTI_ALIAS_FLAG);

    Fnaf1StripView(Context context, Fnaf1Strip strip) {
        super(context);
        this.strip = strip;
        setFocusable(false);
        setFocusableInTouchMode(false);
        setClickable(false);
        setLongClickable(false);
        setWillNotDraw(false);
        fill.setColor(0xff090c10);
        headline.setColor(0xff9ee8ff);
        headline.setTextSize(21f);
        headline.setTypeface(Typeface.DEFAULT_BOLD);
        body.setColor(0xfff0f3f5);
        body.setTextSize(15f);
        body.setTypeface(Typeface.DEFAULT);
        setContentDescription("FNaF 1 teaching strip; noninteractive");
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        int width = Fnaf1Strip.RIGHT - Fnaf1Strip.LEFT;
        int height = Fnaf1Strip.BOTTOM - Fnaf1Strip.TOP;
        canvas.save();
        canvas.scale(getWidth() / (float) width, getHeight() / (float) height);
        canvas.drawRect(0, 0, width, height, fill);
        canvas.drawText(strip.headline(), 12f, 20f, headline);
        canvas.drawText(strip.lesson(), 12f, 42f, body);
        canvas.restore();
    }
}
