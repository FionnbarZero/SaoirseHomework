# Read-only Google Calendar setup

The daily quest can show events from one specifically approved Google account. It requests only identity verification and `calendar.events.readonly`. Events never create homework completion credit.

## Google Cloud setup

1. In a parent-managed Google Cloud project, enable **Google Calendar API**.
2. Configure the OAuth consent screen. If the app is in Testing, add the calendar account as a test user.
3. Create an OAuth client with application type **Desktop app**.
4. Put the client ID, optional client secret, and calendar account in the local `.env` file:

   ```text
   HOMEWORK_GOOGLE_CLIENT_ID=...
   HOMEWORK_GOOGLE_CLIENT_SECRET=...
   HOMEWORK_CALENDAR_ACCOUNT_EMAIL=...
   HOMEWORK_CALENDAR_ID=primary
   ```

5. Restart the app, open **Parent controls**, and choose **Connect Google Calendar**. Google or Family Link may ask the guardian to approve access.

The refresh token is stored in a separate macOS Keychain item. The app sends the browser only event title, date, start/end time, and all-day status. It does not import descriptions, guests, attachments, meeting links, or completion state.

To stop access, use **Disconnect Calendar** in Parent controls. This revokes Google access and removes the local Keychain token.
