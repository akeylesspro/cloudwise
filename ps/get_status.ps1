$currentProject = gcloud config get-value project
if ($currentProject -eq "akeyless-nx-qa") {
    $imageName = "nx-charge-qa"
    $environment = "QA"
}
else { 
    $imageName = "nx-charge"
    $environment = "PROD"
}

gcloud container clusters get-credentials nx-api --zone europe-west1


$tagsOutput = gcloud container images list-tags gcr.io/${currentProject}/${imageName} --format="json"

# Parse JSON output
$tags = $tagsOutput | ConvertFrom-Json

$allTags = $tags | ForEach-Object { $_.tags } | Where-Object { $_ -ne $null } | ForEach-Object { $_ } | Where-Object { $_ -ne "latest" } | Sort-Object -Unique

# Find the tag with "latest"
$latestTag = $tags | Where-Object { $_.tags -contains "latest" }

$servicesOutput = kubectl get services --namespace ingress-nginx -o json

# Parse JSON output
$services = $servicesOutput | ConvertFrom-Json
$externalNatIp = gcloud compute addresses list --filter="purpose=NAT_AUTO" --format="value(address)"
# Extract the external IP address
$externalIngressIp = $services.items | Where-Object { $_.status.loadBalancer.ingress } | ForEach-Object { $_.status.loadBalancer.ingress[0].ip }

if ($latestTag) {
    $validVersion = $latestTag.tags | Where-Object { $_ -ne "latest" }
    Write-Host "Environment: $environment"
    Write-Host "Google Project: $currentProject"
    Write-Host "Project: $imageName"
    Write-Host "External Ingrees IP: $externalIngressIp"
    Write-Host "External NAT IP: $externalNatIp"
    Write-Host "Version: latesclst:$validVersion"
    Write-Host "Possible Versions: $($allTags -join ', ')"
    kubectl get pods

}
else {
    Write-Host "Error: No 'latest' tag found."
}
Write-Host ""
