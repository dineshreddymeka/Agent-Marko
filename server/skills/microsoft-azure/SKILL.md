---
name: microsoft-azure
description: Operate Microsoft Azure — Azure CLI, PowerShell (Az), Entra ID, RBAC, VMs, Storage, Key Vault, App Service, AKS, and ARM/Bicep with safe auth and subscription scoping.
triggers: ["azure", "microsoft azure", "az cli", "az account", "azure powershell", "azurerm", "bicep", "arm template", "entra id", "azure ad", "azure rbac", "key vault", "app service", "aks", "virtual machine", "storage account", "azure subscription", "managed identity"]
---

# Microsoft Azure

Use this skill when the task involves **Azure cloud infrastructure or identity** — subscriptions, resource groups, VMs, storage, networking, Kubernetes, serverless, or Entra ID (formerly Azure AD) app registrations and RBAC. For **M365 productivity** (Outlook, Word, Teams, Graph mail/calendar), use the `microsoft-office` skill.

## Auth and subscription context

**Azure CLI (interactive):**
```bash
az login                          # browser or device code
az account list -o table
az account set --subscription SUBSCRIPTION_ID_OR_NAME
az account show
```

**Service principal (automation):**
```bash
az login --service-principal -u APP_ID -p SECRET --tenant TENANT_ID
# Prefer federated credentials (GitHub/OIDC) over long-lived secrets
```

**PowerShell (Az module):**
```powershell
Connect-AzAccount
Get-AzContext
Set-AzContext -Subscription "My Subscription"
```

**Managed identity:** on Azure VMs, App Service, AKS — use `DefaultAzureCredential` (SDK) or IMDS token endpoint; no secrets in code.

**Verify before destructive ops:**
```bash
az account show --query "{name:name, id:id, user:user.name}" -o json
```

Always pass `--subscription` on scripts that may run in CI with multiple accounts.

## RBAC and Entra ID

- **RBAC** assigns roles (`Contributor`, `Reader`, custom) at management group, subscription, resource group, or resource scope.
- **Entra ID** manages users, groups, app registrations, conditional access — distinct from Azure resource RBAC but linked via `objectId`.
- Principle of least privilege: prefer **custom roles** or scoped assignments (`/subscriptions/.../resourceGroups/RG`).
- **Managed identities:** system-assigned (tied to one resource) vs user-assigned (shared); grant RBAC to the identity's `principalId`.

```bash
az role assignment list --assignee USER_OR_SP --scope /subscriptions/SUB_ID
az ad sp create-for-rbac --name my-app --role Contributor --scopes /subscriptions/SUB_ID/resourceGroups/RG
```

**App registrations (OAuth):**
- Entra ID → App registrations → redirect URIs, certificates/secrets, API permissions.
- **Delegated** vs **Application** permissions mirror Microsoft Graph patterns (see `microsoft-office` skill).
- Hermes Office Briefing uses a **Web** platform app with auth code + PKCE — not SPA.

## Common CLI patterns

### Resource groups and tags
```bash
az group list -o table
az group create -n RG -l eastus
az tag update --resource-id ID --operation merge --tags env=prod
```

### Virtual machines
```bash
az vm list -o table
az vm show -g RG -n VM --query "instanceView.statuses"
az vm run-command invoke -g RG -n VM --command-id RunShellScript --scripts "uptime"
az ssh vm -g RG -n VM   # Azure CLI 2.59+ with SSH extension
```

### Storage
```bash
az storage account list -o table
az storage container list --account-name ACCOUNT --auth-mode login
az storage blob upload -f LOCAL -c CONTAINER -n PATH --account-name ACCOUNT --auth-mode login
```

### Key Vault
```bash
az keyvault secret set --vault-name VAULT --name SECRET --value VALUE
az keyvault secret show --vault-name VAULT --name SECRET --query value -o tsv
```
Never echo secrets into chat logs; prefer `--query` to stdout in controlled environments only.

### App Service / Functions
```bash
az webapp list -o table
az webapp log tail -g RG -n APP
az functionapp list -o table
```

### AKS
```bash
az aks list -o table
az aks get-credentials -g RG -n CLUSTER --admin   # admin kubeconfig; prefer --admin false + Azure RBAC
kubectl get nodes
```

### Monitoring
```bash
az monitor activity-log list --offset 1h -o table
az monitor metrics list --resource ID --metric "Percentage CPU"
```

## Infrastructure as Code

- **Bicep** (preferred): compiles to ARM; deploy with `az deployment group create`.
- **ARM JSON templates**: legacy but still supported.
- **Terraform**: `azurerm` provider; store remote state in Azure Storage with locking.
- **What-if**: `az deployment group what-if` before apply.

Review public endpoints, NSG rules, and `publicNetworkAccess` on PaaS services in every plan.

## SDK notes

- **Node:** `@azure/identity` + service client packages (`@azure/storage-blob`, etc.).
- **Python:** `azure-identity`, `azure-mgmt-*`.
- Use `DefaultAzureCredential` chain: env vars → managed identity → CLI (dev only).

## Troubleshooting checklist

1. Wrong subscription? `az account show`
2. Authorization failed? `az role assignment list --assignee ME --scope RESOURCE_ID`
3. Resource provider not registered? `az provider register --namespace Microsoft.Compute`
4. Quota? Portal → Subscriptions → Usage + quotas, or support ticket
5. Graph vs Azure ARM confusion? Graph = M365 data; ARM = cloud resources

## Safety

- Do not commit service principal secrets or connection strings.
- Use Key Vault references in App Service instead of plain app settings for secrets.
- Confirm `--yes` / `--force` flags before delete operations on production RGs.
- Private endpoints + disable public access for sensitive storage/SQL when possible.

## References

- Azure CLI: https://learn.microsoft.com/en-us/cli/azure/
- Bicep: https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/
- Entra ID / app registration: https://learn.microsoft.com/en-us/entra/identity-platform/
- RBAC: https://learn.microsoft.com/en-us/azure/role-based-access-control/
