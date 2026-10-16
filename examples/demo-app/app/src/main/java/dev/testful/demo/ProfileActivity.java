package dev.testful.demo;

import android.widget.EditText;
import android.widget.TextView;

public class ProfileActivity extends Screen {
    @Override
    protected void build() {
        title("Profil");
        EditText name = new EditText(this);
        name.setHint("Adın");
        root.addView(name);
        TextView greeting = new TextView(this);
        button("Kaydet", null).setOnClickListener(v -> {
            String n = name.getText().toString().trim();
            greeting.setText(n.isEmpty() ? "Lütfen adını yaz" : "Merhaba, " + n);
        });
        root.addView(greeting);
    }
}
