# tt-dashboard

Private installable dashboard (PWA). All business data lives in `data.enc.json`, encrypted with AES-256-GCM (key derived with PBKDF2-SHA256). It is decrypted only in the browser with a passphrase that is not stored in this repo.
