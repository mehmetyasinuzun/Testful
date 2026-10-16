package dev.testful.demo;

import android.widget.TextView;

public class AboutActivity extends Screen {
    @Override
    protected void build() {
        title("Hakkında");
        TextView v = new TextView(this);
        v.setText("Sürüm 1.0");
        root.addView(v);
    }
}
