package dev.testful.demo;

import android.content.Intent;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;

/** Kaydırma gerektiren uzun liste: son ürün yalnız aşağı kaydırınca görünür. */
public class ProductsActivity extends Screen {
    @Override
    protected void build() {
        title("Ürünler");
        ScrollView scroll = new ScrollView(this);
        LinearLayout list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        for (int i = 1; i <= 25; i++) {
            Button b = new Button(this);
            b.setText("Ürün " + i);
            b.setAllCaps(false);
            if (i == 25) b.setOnClickListener(v -> startActivity(new Intent(this, DetailActivity.class)));
            list.addView(b);
        }
        scroll.addView(list);
        root.addView(scroll, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));
    }
}
