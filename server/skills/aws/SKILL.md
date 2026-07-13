---
name: aws
description: Operate Amazon Web Services — AWS CLI, IAM, S3, EC2, Lambda, CloudFormation, CDK, and common security patterns with profile/role scoping.
triggers: ["aws", "amazon web services", "aws cli", "iam", "s3 bucket", "ec2", "lambda", "cloudformation", "cdk", "aws cloud", "sts assume-role", "aws profile", "route53", "rds", "eks", "cloudwatch", "secrets manager"]
---

# Amazon Web Services (AWS)

Use this skill when the task involves **AWS resources or automation** — IAM, S3, EC2, Lambda, networking, databases, EKS, or infrastructure as code (CloudFormation / CDK / Terraform).

## Auth and account context

**AWS CLI profiles (`~/.aws/credentials` + `config`):**
```bash
aws sts get-caller-identity          # who am I?
aws configure list
export AWS_PROFILE=my-profile
export AWS_REGION=us-east-1
```

**SSO (IAM Identity Center):**
```bash
aws sso login --profile CORP
aws sts get-caller-identity --profile CORP
```

**Assume role (cross-account or CI):**
```bash
aws sts assume-role --role-arn arn:aws:iam::ACCOUNT:role/ROLE \
  --role-session-name session --duration-seconds 3600
# Export AccessKeyId, SecretAccessKey, SessionToken from output
```

**Never** commit access keys or session tokens. Prefer **IAM roles** on EC2/Lambda/EKS (instance/task roles) over long-lived users.

**Verify before destructive commands:**
```bash
aws sts get-caller-identity --query '{Account:Account,Arn:Arn}' --output table
```

## IAM and safety

- **Users** (humans) → groups → policies; **roles** (workloads) → trust policy + permission policies.
- Least privilege: scoped actions + resource ARNs; use **permission boundaries** for delegated admin.
- Prefer **managed policies** (AWS or customer) over inline for reuse; attach at group/role level.
- MFA for console users; deny `*` on `*` except break-glass accounts.
- **Service control policies (SCPs)** apply at Organizations level — a allow in IAM can still be denied by SCP.

```bash
aws iam list-attached-user-policies --user-name USER
aws iam simulate-principal-policy --policy-source-arn ARN \
  --action-names s3:GetObject --resource-arns arn:aws:s3:::bucket/*
```

## Common CLI patterns

### S3
```bash
aws s3 ls
aws s3 ls s3://BUCKET/prefix/
aws s3 cp LOCAL s3://BUCKET/key/
aws s3 sync ./dir s3://BUCKET/prefix/ --delete   # review before --delete
aws s3api get-bucket-policy --bucket BUCKET
aws s3api put-object-acl --bucket BUCKET --key KEY --acl private   # avoid public-read
```

Block Public Access should stay enabled unless there is an explicit static-site pattern with OAI/OAC.

### EC2
```bash
aws ec2 describe-instances --filters "Name=instance-state-name,Values=running" \
  --query 'Reservations[].Instances[].{Id:InstanceId,Name:Tags[?Key==`Name`].Value|[0],Type:InstanceType}' --output table
aws ec2 describe-instance-status --instance-ids i-INSTANCE
aws ssm start-session --target i-INSTANCE   # prefer SSM over SSH keys when possible
```

### Lambda
```bash
aws lambda list-functions --query 'Functions[].FunctionName' --output table
aws lambda invoke --function-name FN --payload '{}' /tmp/out.json
aws logs tail /aws/lambda/FN --since 1h
```

### CloudFormation
```bash
aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE
aws cloudformation describe-stack-events --stack-name STACK
aws cloudformation deploy --template-file template.yaml --stack-name STACK \
  --capabilities CAPABILITY_IAM --parameter-overrides Key=Value
```

### EKS
```bash
aws eks list-clusters
aws eks update-kubeconfig --name CLUSTER --region REGION
kubectl get nodes
```

### Secrets Manager / SSM Parameter Store
```bash
aws secretsmanager get-secret-value --secret-id NAME --query SecretString --output text
aws ssm get-parameter --name /app/config --with-decryption
```
Do not paste secret values into chat.

## Infrastructure as Code

| Tool | Notes |
|------|-------|
| **CloudFormation** | Native YAML/JSON; `aws cloudformation deploy` |
| **AWS CDK** | TypeScript/Python/etc. → synth to CloudFormation; `cdk deploy` |
| **Terraform** | `hashicorp/aws` provider; remote state in S3 + DynamoDB lock |

Always run **plan/diff** before apply. Review IAM policy changes, security group `0.0.0.0/0` rules, and S3 public access.

**CDK quick pattern:**
```bash
cdk synth
cdk diff
cdk deploy STACK --require-approval broadening
```

## SDK notes

- **Node:** `@aws-sdk/client-*` (v3 modular clients); default credential chain matches CLI.
- **Python:** `boto3`; use `session.client('s3', region_name=REGION)`.
- Set `AWS_REGION` explicitly; some global services (IAM, Route 53) still need a region for signing.

## CloudWatch and debugging

```bash
aws logs describe-log-groups --log-group-name-prefix /aws/
aws logs filter-log-events --log-group-name GROUP --filter-pattern "ERROR"
aws cloudwatch get-metric-statistics --namespace AWS/Lambda --metric-name Errors \
  --dimensions Name=FunctionName,Value=FN --start-time START --end-time END \
  --period 300 --statistics Sum
```

## Troubleshooting checklist

1. Wrong account/role? `aws sts get-caller-identity`
2. Access denied? simulate policy; check SCPs and resource-based policies (S3 bucket policy, KMS key policy)
3. Wrong region? `aws configure get region` — ARNs are regional except IAM, Route53, CloudFront
4. API not enabled? most AWS APIs are on by default; some (e.g. certain Marketplace) need enablement
5. Throttling? exponential backoff; request limit increase if sustained

## Safety

- No `aws s3 sync --delete` or `rm` on production without explicit confirmation.
- Use `--dry-run` where supported (e.g. S3 sync on older CLI via `--size-only` review first).
- Enable CloudTrail and GuardDuty in security-sensitive accounts.
- Rotate access keys; prefer roles + SSO.

## When to split work

- **Microsoft 365 / Graph** → `microsoft-office`
- **Azure ARM / Entra** → `microsoft-azure`
- **GCP** → `google-cloud`

## References

- AWS CLI: https://docs.aws.amazon.com/cli/latest/userguide/
- IAM best practices: https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html
- CDK: https://docs.aws.amazon.com/cdk/v2/guide/home.html
- CloudFormation: https://docs.aws.amazon.com/cloudformation/
