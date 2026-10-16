package dev.testful.demo;

import android.content.Intent;
import android.text.InputType;
import android.widget.EditText;
import android.widget.TextView;

/** Giriş duvarı. Herkese açık demo hesabı: demo@testful.dev / Demo&1234 (gizli değildir). */
public class LoginActivity extends Screen {
    static final String USER = "demo@testful.dev";
    static final String PASS = "Demo&1234";

    @Override
    protected void build() {
        title("Hoş geldin");
        EditText email = new EditText(this);
        email.setHint("E-posta");
        email.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
        root.addView(email);
        EditText pass = new EditText(this);
        pass.setHint("Şifre");
        pass.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        root.addView(pass);
        TextView error = new TextView(this);
        button("Giriş", null).setOnClickListener(v -> {
            if (USER.equals(email.getText().toString().trim()) && PASS.equals(pass.getText().toString())) {
                startActivity(new Intent(this, MainActivity.class));
                finish();
            } else {
                error.setText("Hatalı e-posta ya da şifre");
            }
        });
        root.addView(error);
    }
}
