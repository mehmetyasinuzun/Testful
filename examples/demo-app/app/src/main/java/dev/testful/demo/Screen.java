package dev.testful.demo;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Testful CI öz-testi için kasıtlı olarak küçük, bağımlılıksız ekran iskeleti. */
abstract class Screen extends Activity {
    protected LinearLayout root;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        int pad = dp(24);
        root.setPadding(pad, pad, pad, pad);
        setContentView(root);
        build();
    }

    protected abstract void build();

    protected int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    protected TextView title(String text) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setTextSize(24);
        t.setPadding(0, 0, 0, dp(16));
        root.addView(t);
        return t;
    }

    protected Button button(String text, Class<? extends Activity> target) {
        Button b = new Button(this);
        b.setText(text);
        if (target != null) b.setOnClickListener(v -> startActivity(new Intent(this, target)));
        root.addView(b, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        return b;
    }
}
