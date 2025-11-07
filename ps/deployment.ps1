param (
    [string]$v,
    [string]$c
)
$versionFilePath = "./package.json"
$versionJson = Get-Content $versionFilePath | ConvertFrom-Json
if ($v) {
    $versionJson.version = $v
}
else {
    $temp = $versionJson.version
    Write-Output "--- No version provided, updates current version from version.json file - $temp  ---"
}
$version = $versionJson.version
$currentProject = gcloud config get-value project
if (-not $c) {
    $response = Read-Host "You are in $currentProject. Do you want to continue with the deployment version $version ? (y/n)"
    if ($response -ne "y") {
        Write-Output "Deployment aborted by the user."
        exit 0
    }
}

if ($v) {
    $versionJson | ConvertTo-Json -Depth 10 | Set-Content $versionFilePath
}
if ($currentProject -eq "akeyless-nx-qa") {
    Write-Host "--------------- QA mode ----------------"
    $enviroment = "qa"
    $imageName = "nx-charge-qa"
    $deploymentName = "nx-charge-deployment-qa"
}
else {
    Write-Host "--------------- PROD mode ----------------"
    $enviroment = "prod"
    $imageName = "nx-charge"
    $deploymentName = "nx-charge-deployment"
}
# ***** set kubectl context to cuurent project *****
gcloud container clusters get-credentials nx-api --zone europe-west1
# Build the Docker image with the new version
docker build --build-arg ENV=$enviroment -t gcr.io/${currentProject}/${imageName}:${version} .
# Tag the new image as 'latest'
docker tag gcr.io/${currentProject}/${imageName}:${version} gcr.io/${currentProject}/${imageName}:latest
# Push both tags to Google Container Registry
docker push gcr.io/${currentProject}/${imageName}:${version}
docker push gcr.io/${currentProject}/${imageName}:latest
# Restart the Kubernetes deployment to ensure it's using the latest image
kubectl rollout restart deployment/${deploymentName}
# Check the status of the pods to ensure the deployment was successful
kubectl get pods
