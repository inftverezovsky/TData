## TData GitHub Save Agent

This project is named `TData` and is stored locally at:

`C:\Users\Sa1z1ngr0z\Desktop\TData`

Public production domain:

`https://www.tdata.info/`

Canonical GitHub repository:

`https://github.com/inftverezovsky/TData.git`

Use the project save agent for commit and push work:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\git-save-agent.ps1 -Message "Describe the saved change"
```

Agent rules:

- Keep `origin` pointed at `https://github.com/inftverezovsky/TData.git`.
- Commit as `inftverezovsky <inf.tverezovsky@gmail.com>`.
- Push the current project state to the `main` branch.
- Do not store GitHub passwords, personal access tokens, or credential helper output in files, docs, shell history, or chat responses.
- Do not add the accidental nested `TData/` clone to this repository.
- If GitHub asks for authentication, use Git Credential Manager, `gh auth login`, or a personal access token entered only in the secure credential prompt.
