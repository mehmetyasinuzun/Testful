package dev.testful.demo;

import android.widget.Switch;

public class SettingsActivity extends Screen {
    @Override
    protected void build() {
        title("Ayarlar");
        Switch dark = new Switch(this);
        dark.setText("Karanlık mod");
        root.addView(dark);
        button("Hakkında", AboutActivity.class);
        // Keşif bunu "riskli" sayıp dokunmamalı.
        button("Hesabı sil", null);
    }
}
