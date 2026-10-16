package dev.testful.demo;

import android.widget.ImageButton;

public class MainActivity extends Screen {
    @Override
    protected void build() {
        title("Testful Demo");
        button("Profil", ProfileActivity.class);
        button("Ayarlar", SettingsActivity.class);
        button("Ürünler", ProductsActivity.class);

        // Kasıtlı a11y kusuru: etiketsiz ikon buton (Testful "a11y-eksik" bulgusu üretmeli).
        ImageButton gear = new ImageButton(this);
        gear.setImageResource(android.R.drawable.ic_menu_info_details);
        gear.setOnClickListener(v -> startActivity(new android.content.Intent(this, AboutActivity.class)));
        root.addView(gear);
    }
}
