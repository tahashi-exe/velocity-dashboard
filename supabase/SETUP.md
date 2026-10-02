# Account setup, step by step

Everything here is done in a web dashboard. Nothing needs code. Do the parts
in order: each one ends with a quick check so you know it worked.

Dashboards rename their menus from time to time. If a label is slightly
different from what's written here, look for the closest match.

**Never paste a password, App password, client secret or secret key into a
chat or into this repo.** They go only into the dashboard fields named below.

Project used throughout: `velocity-dev` (ref `lxbawcwywniasqiriske`).

---

## Part 1 — Send sign-in emails from Velocity (about 10 minutes)

Until this is done, Supabase only emails people who are members of your
Supabase organization, and the sender shows as "Supabase Auth".

### 1a. Create a Gmail App password

An App password is a 16-letter password that lets one app send mail from the
account without knowing your real password.

1. Sign in to Google as **velocityapp971@gmail.com**.
2. Open <https://myaccount.google.com/signinoptions/twosv> and turn on
   **2-Step Verification** if it isn't already on. Google requires it before
   it will offer App passwords.
3. Open <https://myaccount.google.com/apppasswords>.
4. In **App name** type `Velocity Supabase` and click **Create**.
5. Google shows a 16-letter password. Copy it now; it is shown only once.
   Keep the tab open until step 1b is finished.

### 1b. Enter it in Supabase

1. Open <https://supabase.com/dashboard/project/lxbawcwywniasqiriske/auth/smtp>
   (left menu: **Authentication** → **Emails** → **SMTP Settings**).
2. Turn on **Enable custom SMTP**.
3. Fill in:

   | Field | Value |
   |---|---|
   | Sender email address | `velocityapp971@gmail.com` |
   | Sender name | `VelocityAE` |
   | Host | `smtp.gmail.com` |
   | Port number | `465` |
   | Username | `velocityapp971@gmail.com` |
   | Password | the 16-letter App password, without spaces |

4. Leave **Minimum interval per user** as it is and click **Save changes**.

**Limits to know about:** Supabase starts a custom sender at 30 emails an hour
(changeable under **Authentication** → **Rate Limits**), and a free Gmail
account sends at most about 500 emails a day. Both are plenty for friends.

---

## Part 2 — Put the sign-in code in the emails (about 5 minutes)

The app lets people type a code instead of tapping a link, but the default
emails contain only a link.

1. Open <https://supabase.com/dashboard/project/lxbawcwywniasqiriske/auth/templates>
   (**Authentication** → **Emails** → **Templates**).
2. Choose the **Confirm signup** template. This is the email a person gets the
   first time they sign in.
3. Set **Subject** to:

   ```
   Your VelocityAE sign-in code
   ```

4. Replace everything in the **Body** with:

   ```html
   <h2>Sign in to VelocityAE</h2>
   <p>Your sign-in code is:</p>
   <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px;">{{ .Token }}</p>
   <p>Type it into the app. Or tap this link, on the same phone or computer and in the same browser you started in:</p>
   <p><a href="{{ .ConfirmationURL }}">Sign in to VelocityAE</a></p>
   <p>If you didn't ask for this, you can ignore this email.</p>
   ```

5. Click **Save changes**.
6. Choose the **Magic Link** template (the email for every sign-in after the
   first) and repeat steps 3 to 5 with the same subject and body.

---

## Part 3 — Tell Supabase where the app lives (about 2 minutes)

After someone signs in, Supabase only sends them back to addresses on this
list.

1. Open <https://supabase.com/dashboard/project/lxbawcwywniasqiriske/auth/url-configuration>
   (**Authentication** → **URL Configuration**).
2. Set **Site URL** to:

   ```
   https://tahashi-exe.github.io/velocity-dashboard/
   ```

   and click **Save changes**.
3. Under **Redirect URLs** click **Add URL** and add these two, one at a time:

   ```
   https://tahashi-exe.github.io/velocity-dashboard/**
   ```

   ```
   http://localhost:8765/**
   ```

### Check parts 1 to 3

1. Open <http://localhost:8765> and tap **Let's Run?**.
2. Open any run and tap **Going**.
3. Enter an email address that is **not** your Supabase login, for example a
   second address of your own, and tap **Email me a code**.
4. The email should arrive from **VelocityAE**, with a code in it. Type the
   code into the app. The run should show as Going.

If no email arrives, re-check the App password in 1b: it must be the 16
letters with no spaces, and the username must be the full Gmail address.

---

## Part 4 — Sign in with Google (about 15 minutes)

Google needs to know which app is asking people to sign in. You register the
app once in Google Cloud, which gives you a **Client ID** and a **Client
secret**, and you paste those two into Supabase.

### 4a. Create the Google Cloud project

1. Open <https://console.cloud.google.com/> signed in as
   **velocityapp971@gmail.com**. If it asks you to agree to the Google Cloud
   terms, that is for you to read and accept. There is no charge for this.
2. Click the project picker at the top left (it may say "Select a project"),
   then **New project**.
3. Name it `Velocity`, click **Create**, and wait for it to finish. Then open
   the project picker again and select **Velocity**.

### 4b. Describe the app

1. Open <https://console.cloud.google.com/auth/overview> and click
   **Get started**.
2. **App information:** App name `VelocityAE`, User support email
   `velocityapp971@gmail.com`. Click **Next**.
3. **Audience:** choose **External**. Click **Next**.
4. **Contact information:** `velocityapp971@gmail.com`. Click **Next**.
5. Tick the box agreeing to Google's user data policy, then **Continue** and
   **Create**.

Don't upload a logo. A logo triggers a Google review that takes days; without
one, no review is needed.

### 4c. Choose what the app may see

1. Open <https://console.cloud.google.com/auth/scopes> (**Data Access**).
2. Click **Add or remove scopes**.
3. Tick these three and nothing else:
   - `.../auth/userinfo.email`
   - `.../auth/userinfo.profile`
   - `openid`
4. Click **Update**, then **Save**.

These give Velocity a person's name, email address and profile photo, and
nothing more.

### 4d. Open it to everyone

1. Open <https://console.cloud.google.com/auth/audience> (**Audience**).
2. Under **Publishing status** it says "Testing". Click **Publish app** and
   confirm. It should now say **In production**.

While it says "Testing", only people you list by hand can sign in.

### 4e. Create the Client ID and secret

1. Open <https://console.cloud.google.com/auth/clients> (**Clients**) and
   click **Create client**.
2. **Application type:** `Web application`. **Name:** `Velocity web`.
3. Under **Authorized JavaScript origins** click **Add URI** and add these two:

   ```
   https://tahashi-exe.github.io
   ```

   ```
   http://localhost:8765
   ```

4. Under **Authorized redirect URIs** click **Add URI** and add exactly:

   ```
   https://lxbawcwywniasqiriske.supabase.co/auth/v1/callback
   ```

5. Click **Create**. A box shows the **Client ID** and **Client secret**. Keep
   it open, or click **Download JSON**, because the secret isn't shown again
   later.

### 4f. Paste them into Supabase

1. Open <https://supabase.com/dashboard/project/lxbawcwywniasqiriske/auth/providers?provider=Google>
   (**Authentication** → **Sign In / Providers** → **Google**).
2. Turn on **Enable Sign in with Google**.
3. Paste the **Client ID** into **Client IDs** and the **Client secret** into
   **Client Secret (for OAuth)**.
4. Click **Save**.

### Check part 4

1. Reload <http://localhost:8765>, open a run and tap **Going**.
2. The sign-in sheet should now show **Continue with Google** above the email
   field. Tap it and choose an account.
3. You should land back in the app, signed in, with the run marked Going.

Google's screen will say "to continue to lxbawcwywniasqiriske.supabase.co".
That is expected on the free setup; showing "VelocityAE" there needs a custom
domain and Google's brand review.

If Google shows **Error 400: redirect_uri_mismatch**, the address in 4e step 4
has a typo. It must match the one above exactly.

---

## Part 5 — Give the Telegram bot its secrets (about 10 minutes)

The bot runs inside this same Supabase project, as an Edge Function called
`telegram-bot`. It needs four values, entered once as **secrets**. A secret is
write-only: after saving, nobody can read it back, including you.

**If a token has ever been pasted into a chat, an email or a document, replace
it first** (steps 5a and 5b create fresh ones). Anyone holding the bot token
can control the bot, and the GitHub token can edit the repo.

### 5a. A fresh Telegram bot token

1. In Telegram, open **@BotFather**.
2. Send `/revoke` and choose your bot. BotFather replies with a new token and
   the old one stops working at once.
3. Keep that message open for step 5c.

Your numeric Telegram ID is the `Id:` line that **@userinfobot** shows you. It
isn't a secret, but only you should be the admin.

### 5b. A fresh GitHub token, limited to this one repo

1. Open <https://github.com/settings/personal-access-tokens> (your profile
   picture → **Settings** → **Developer settings** → **Personal access tokens**
   → **Fine-grained tokens**).
2. Delete any older token made for the bot. If one starts with `ghp_`, it is
   the older kind and is listed under **Tokens (classic)** instead.
3. Click **Generate new token**.
4. **Token name:** `velocity-telegram-bot`. **Expiration:** your choice; when
   it expires the bot stops publishing until you repeat this step.
5. **Repository access:** **Only select repositories** → `velocity-dashboard`.
6. **Permissions** → **Repository permissions** → **Contents** → **Read and
   write**. Leave everything else as it is.
7. Click **Generate token** and copy it. It is shown only once.

### 5c. Enter the four secrets

1. Open <https://supabase.com/dashboard/project/lxbawcwywniasqiriske/functions/secrets>
   (left menu: **Edge Functions** → **Secrets**).
2. Add these four, one row each, then **Save**:

   | Name | Value |
   |---|---|
   | `TELEGRAM_BOT_TOKEN` | the token from 5a |
   | `TELEGRAM_ADMIN_CHAT_ID` | your numeric Telegram ID |
   | `GITHUB_TOKEN` | the token from 5b |
   | `GITHUB_REPOSITORY` | `tahashi-exe/velocity-dashboard` |

   The names must match exactly, capitals and underscores included.

### Check part 5

1. Open <https://lxbawcwywniasqiriske.supabase.co/functions/v1/telegram-bot>.
   It should show `{"ok":true}`. If it lists names under `missing`, those
   secrets aren't saved yet or are misspelled.
2. Open <https://lxbawcwywniasqiriske.supabase.co/functions/v1/telegram-bot?setup>.
   This connects Telegram to the bot. It should show your bot's username and
   `"last_error":null`.
3. In Telegram, send your bot `/start`. It should answer within a few seconds.
4. Send `/newclub`, fill in the block it sends, and approve. The bot should
   reply **Published to GitHub and saved to the database**.

Run step 2 again any time you replace the bot token.

The old Railway project is no longer used and can be deleted from Railway's
dashboard whenever you like.
