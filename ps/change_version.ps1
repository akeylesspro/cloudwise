param (
    [string]$version
)
if (-not $version) {
    Write-Output "Error: Version is required."
    exit 1
}
$currentProject = gcloud config get-value project
if ($currentProject -eq "akeyless-nx-qa") {
    Write-Host "--------------- QA mode ----------------"
    $imageName = "nx-charge-qa"
    $deploymentName = "nx-charge-deployment-qa"
}
else {
    Write-Host "--------------- PROD mode ----------------"
    $imageName = "nx-charge"
    $deploymentName = "nx-charge-deployment"
}
gcloud container clusters get-credentials nx-api --zone europe-west1
$tagsOutput = gcloud container images list-tags gcr.io/${currentProject}/${imageName} --format="get(tags)"
$tagsArray = $tagsOutput -split ';|,' | Where-Object { $_ -ne "latest" }
Write-Output ""
# Check if the version exists
if ($tagsArray -contains $version) {
    docker tag gcr.io/${currentProject}/${imageName}:${version} gcr.io/${currentProject}/${imageName}:latest
    docker push gcr.io/${currentProject}/${imageName}:latest
    kubectl rollout restart deployment/${deploymentName}
    kubectl get pods
    Write-Output "Current Version: latest:$version"
}
else {
    Write-Output "Error: Version does not exist $version"
    Write-Output "possible versions: $($tagsArray -join ', ')"
}
Write-Output ""
