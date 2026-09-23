@echo off
setlocal enabledelayedexpansion
title Yimly Home Assistant - Deployment and Update Manager

echo ===============================================================================
echo                YIMLY HOME ASSISTANT - PRODUCTION MANAGER
echo ===============================================================================
echo.

:: 1. Verify working directory
if not exist "docker-compose.yml" (
    echo [ERROR] docker-compose.yml not found in current directory.
    echo Please make sure you run update.bat from the root of the repository.
    echo.
    pause
    exit /b 1
)

:: 2. Check Git availability
echo [1/7] Checking Git installation...
where git >nul 2>&1
if %errorlevel% neq 0 (
    echo [WARNING] Git command not found in PATH.
    echo Continuing deployment with local repository files...
) else (
    echo [OK] Git is available.
    :: If inside a git repo with remote, attempt safe pull
    if exist ".git" (
        echo Checking for remote repository updates...
        git fetch origin >nul 2>&1
        if !errorlevel! equ 0 (
            echo Pulling latest changes from GitHub...
            git pull --ff-only
            if !errorlevel! neq 0 (
                echo [WARNING] Fast-forward pull failed or local changes exist.
                echo Continuing with current codebase without overwriting local state.
            ) else (
                echo [OK] Codebase is up to date.
            )
        ) else (
            echo [INFO] Remote repository not reachable or offline. Continuing with local code.
        )
    )
)
echo.

:: 3. Check Docker and Docker Compose availability
echo [2/7] Checking Docker engine status...
where docker >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker is not installed or not in PATH.
    echo Please install Docker Desktop for Windows: https://www.docker.com/products/docker-desktop/
    echo.
    pause
    exit /b 1
)

docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker Desktop is not currently running.
    echo Please launch Docker Desktop and wait until it is fully initialized, then run update.bat again.
    echo.
    pause
    exit /b 1
)
echo [OK] Docker daemon is running.

:: Determine docker compose command (v2 plugin or v1 standalone)
set DOCKER_COMPOSE_CMD=docker compose
docker compose version >nul 2>&1
if %errorlevel% neq 0 (
    docker-compose version >nul 2>&1
    if %errorlevel% equ 0 (
        set DOCKER_COMPOSE_CMD=docker-compose
    ) else (
        echo [ERROR] Neither 'docker compose' nor 'docker-compose' was found.
        echo Please ensure Docker Compose is enabled in Docker Desktop settings.
        echo.
        pause
        exit /b 1
    )
)
echo [OK] Using '%DOCKER_COMPOSE_CMD%'.
echo.

:: 4. Cloudflare Bridge Network Verification
echo [3/7] Verifying Docker network 'cloudflared_bridge'...
docker network inspect cloudflared_bridge >nul 2>&1
if %errorlevel% neq 0 (
    echo Network 'cloudflared_bridge' does not exist yet. Creating network...
    docker network create cloudflared_bridge >nul 2>&1
    if !errorlevel! equ 0 (
        echo [OK] Created shared Docker network 'cloudflared_bridge'.
    ) else (
        echo [ERROR] Failed to create Docker network 'cloudflared_bridge'.
        pause
        exit /b 1
    )
) else (
    echo [OK] Existing Docker network 'cloudflared_bridge' detected and preserved.
)
echo.

:: 5. Environment and Data Directory Pre-flight
echo [4/7] Preparing environment configuration and data directories...
if not exist ".env" (
    if exist ".env.example" (
        echo Creating initial .env from .env.example...
        copy .env.example .env >nul
    ) else (
        echo Creating initial .env configuration...
        echo APP_ENV=production > .env
        echo PORT=3000 >> .env
    )
    echo [OK] Created .env configuration.
) else (
    echo [OK] Existing .env configuration detected and preserved.
)

if not exist "data" (
    mkdir data
)
if not exist "data\uploads\profile_pictures" (
    mkdir data\uploads\profile_pictures
)
echo [OK] Persistent storage directories verified.
echo.

:: 6. Build and Deploy Containers
echo [5/7] Building production Docker container(s)...
echo This may take a few minutes on first run while frontend and backend build...
%DOCKER_COMPOSE_CMD% build
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Docker build failed. Please inspect build output above for details.
    echo Persistent data was NOT modified.
    echo.
    pause
    exit /b 1
)
echo [OK] Production images built successfully.
echo.

echo [6/7] Starting Yimly Home Assistant services...
%DOCKER_COMPOSE_CMD% up -d --remove-orphans
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Failed to start Docker services.
    echo.
    pause
    exit /b 1
)
echo [OK] Services container started.
echo.

:: 7. Health Check and Startup Verification
echo [7/7] Waiting for Yimly Home Assistant to become healthy and ready...
set HEALTH_TIMEOUT=40
set ELAPSED=0

:HEALTH_LOOP
if !ELAPSED! geq !HEALTH_TIMEOUT! (
    echo.
    echo [WARNING] Health check timed out after !HEALTH_TIMEOUT! seconds.
    echo Container status:
    %DOCKER_COMPOSE_CMD% ps
    echo.
    echo Checking recent container logs:
    %DOCKER_COMPOSE_CMD% logs --tail=25
    echo.
    echo The container may still be starting or initializing database migrations.
    echo You can check progress with: %DOCKER_COMPOSE_CMD% logs -f
    pause
    exit /b 1
)

:: Test server readiness via curl inside container or localhost curl
docker exec yimly_home curl -s -f http://localhost:3000/api/config >nul 2>&1
if !errorlevel! equ 0 (
    goto HEALTHY
)

where curl >nul 2>&1
if !errorlevel! equ 0 (
    curl -s -f http://localhost:3000/api/config >nul 2>&1
    if !errorlevel! equ 0 (
        goto HEALTHY
    )
)

timeout /t 2 /nobreak >nul
set /a ELAPSED+=2
echo Waiting for backend server initialization... (!ELAPSED!s/!HEALTH_TIMEOUT!s)
goto HEALTH_LOOP

:HEALTHY
echo.
echo ===============================================================================
echo            SUCCESS! YIMLY HOME ASSISTANT IS LIVE AND RUNNING
echo ===============================================================================
echo.
echo  Access Points:
echo  ---------------------------------------------------------------------------
echo  * Local Web UI:               http://localhost:3000
echo  * Network Access:             http://^<YOUR-PC-IP^>:3000
echo  * Cloudflare Target Service:  http://yimly_home:3000 (Network: cloudflared_bridge)
echo  * Cloudflare Public Hostname: https://family360.robinhort.link
echo  * Companion App Server URL:   https://family360.robinhort.link (or LAN IP)
echo  ---------------------------------------------------------------------------
echo.
echo  * First-time setup: Open http://localhost:3000 in your browser to create
echo    your administrator account.
echo  * Persistence: All user accounts, circles, device trackers, and telemetry
echo    are safely saved in persistent Docker storage.
echo.
echo  * To update in the future: Simply run update.bat again!
echo ===============================================================================
echo.
pause
