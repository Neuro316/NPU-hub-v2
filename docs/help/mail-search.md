---
id: mail-search
title: Searching every mailbox you can see (mail search for call prep)
route: /mail
help_ids: []
tags: [mail, inbox, search, mailboxes, call prep, morning call prep, scheduled task, private, shared, not searched]
summary: Mail search finds every email to or from a person across the mailboxes you are allowed to see, so the morning call prep can include threads in any of them. It reads Gmail live and stores nothing from it.
related: [notification-settings]
---

## Steps
1. Mail search is a server endpoint, POST /api/agent/mail-search, used by the Morning Call Prep task. It is for platform superadmins.
2. It searches by email address, phone number or name, in the last 365 days unless a date range is given. It looks at received and sent mail in every mailbox you may see.
3. Each match comes back with its mailbox, thread, date, sender, recipients, subject and a short excerpt of at most 300 characters.
4. To read one conversation in full, ask for that thread and its mailbox. Only then are the message texts returned.
5. Mailboxes that could not be searched are listed under not searched with the reason. "Google no longer accepts this sign-in" means reconnect it in Settings, Mailboxes. "Could not be read just now" means a passing problem, and it is tried again on the next search.
6. The Morning Call Prep task calls it with its own key, which acts as Cameron only, so it sees what Cameron sees and nothing more.

## Common mistakes
- A private mailbox is searched only for its owner. Nobody else sees it, superadmin or not. Shared mailboxes are searched for superadmins of their organization.
- Nothing read from Gmail is saved in the Hub. Each search is logged with who ran it, when, which mailboxes and how many results, and a scrambled form of what was searched for, never the words themselves.
- There is a limit of 10 searches every 10 minutes for each person.
- Only a mailbox whose reason says Google no longer accepts the sign-in needs reconnecting. A mailbox shown with an error in Settings is still tried, because the error may have cleared.
