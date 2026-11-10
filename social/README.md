# Instagram posts (Make.com)

`posts.json` lists the posts; `post-NN.jpg` are the 1080×1350 images, served from
`https://fortunejobsai.com/social/`. Images are rendered from the same template, so to add
a post: add an entry to `posts.json` (next id), render its image, and publish the site.

Make.com scenario "Fortune Jobs AI – Instagram posts":
1. Schedule: every 8 hours (3 posts a day; 2 a day = every 12 hours).
2. HTTP → GET `https://fortunejobsai.com/social/posts.json`, parse response.
3. Post number for this run: `mod(floor(formatDate(now; "X") / 28800); length(posts))` (0-based),
   so each 8-hour slot gets the next post and the list repeats in order.
4. Instagram for Business → Create a Photo Post: photo
   `https://fortunejobsai.com/social/post-{{padded id}}.jpg`; caption =
   caption + "\n\n👉 Free at fortunejobsai.com (link in bio)\n\n" + post tags + shared hashtags.
