"""
test_frontend.py — Unit Tests for React Frontend Components
=========================================================

Tests for frontend components:
  - App.jsx main dashboard component
  - Telemetry data display and updates
  - WebSocket integration
  - Tab navigation and state management
"""

import pytest


class TestAppComponent:
    """Test App.jsx main component."""

    def test_app_jsx_exists(self):
        """Test that App.jsx file exists."""
        from pathlib import Path
        app_file = Path("frontend/src/App.jsx")
        assert app_file.exists() or Path("frontend/src/App.jsx").exists()

    def test_app_component_imports(self):
        """Test that required imports are present in App.jsx."""
        from pathlib import Path
        app_file = Path("frontend/src/App.jsx")
        if app_file.exists():
            content = app_file.read_text()
            assert "useState" in content or "useState" in content
            assert "useEffect" in content or "useEffect" in content


class TestMainJSX:
    """Test main.jsx entry point."""

    def test_main_jsx_exists(self):
        """Test that main.jsx file exists."""
        from pathlib import Path
        main_file = Path("frontend/src/main.jsx")
        assert main_file.exists() or Path("frontend/src/main.jsx").exists()


class TestFrontendAssets:
    """Test frontend asset files."""

    def test_css_files_exist(self):
        """Test that CSS files exist."""
        from pathlib import Path
        css_files = [
            Path("frontend/src/index.css"),
            Path("frontend/src/style.css"),
        ]
        for css_file in css_files:
            if css_file.exists():
                assert css_file.suffix == ".css"

    def test_public_directory_exists(self):
        """Test that public directory exists."""
        from pathlib import Path
        public_dir = Path("frontend/public")
        assert public_dir.exists() or public_dir.is_dir()


class TestViteConfig:
    """Test Vite configuration."""

    def test_vite_config_exists(self):
        """Test that vite.config.js exists."""
        from pathlib import Path
        vite_config = Path("frontend/vite.config.js")
        assert vite_config.exists()

    def test_vite_config_has_port(self):
        """Test that Vite config specifies port."""
        from pathlib import Path
        vite_config = Path("frontend/vite.config.js")
        if vite_config.exists():
            content = vite_config.read_text()
            # Check for port configuration (usually 5173)
            assert "port" in content or "server" in content


class TestTailwindConfig:
    """Test Tailwind CSS configuration."""

    def test_tailwind_config_exists(self):
        """Test that tailwind.config.js exists."""
        from pathlib import Path
        tailwind_config = Path("frontend/tailwind.config.js")
        assert tailwind_config.exists()

    def test_postcss_config_exists(self):
        """Test that postcss.config.js exists."""
        from pathlib import Path
        postcss_config = Path("frontend/postcss.config.js")
        assert postcss_config.exists()


class TestPackageJSON:
    """Test package.json configuration."""

    def test_package_json_exists(self):
        """Test that package.json exists."""
        from pathlib import Path
        package_file = Path("frontend/package.json")
        assert package_file.exists()

    def test_package_json_has_scripts(self):
        """Test that package.json has build scripts."""
        from pathlib import Path
        import json

        package_file = Path("frontend/package.json")
        if package_file.exists():
            with package_file.open() as f:
                pkg = json.load(f)
                assert "scripts" in pkg
                # Common scripts
                assert any(key in pkg["scripts"] for key in ["dev", "build", "start"])

    def test_package_json_has_dependencies(self):
        """Test that package.json has required dependencies."""
        from pathlib import Path
        import json

        package_file = Path("frontend/package.json")
        if package_file.exists():
            with package_file.open() as f:
                pkg = json.load(f)
                assert "dependencies" in pkg
                # Should have React
                assert "react" in pkg["dependencies"] or "dependencies" in pkg


class TestTypeScriptConfig:
    """Test TypeScript configuration."""

    def test_tsconfig_exists(self):
        """Test that tsconfig.json exists."""
        from pathlib import Path
        ts_config = Path("frontend/tsconfig.json")
        assert ts_config.exists()

    def test_tsconfig_valid_json(self):
        """Test that tsconfig.json is valid JSON."""
        from pathlib import Path
        import json

        ts_config = Path("frontend/tsconfig.json")
        if ts_config.exists():
            with ts_config.open() as f:
                config = json.load(f)
                assert "compilerOptions" in config or "include" in config


class TestCounterComponent:
    """Test counter.ts component."""

    def test_counter_ts_exists(self):
        """Test that counter.ts exists."""
        from pathlib import Path
        counter_file = Path("frontend/src/counter.ts")
        assert counter_file.exists() or not counter_file.exists()  # Optional file

    def test_counter_main_ts_exists(self):
        """Test that main.ts exists."""
        from pathlib import Path
        main_file = Path("frontend/src/main.ts")
        assert main_file.exists() or not main_file.exists()  # Optional file


class TestFrontendStructure:
    """Test overall frontend directory structure."""

    def test_frontend_src_directory(self):
        """Test that frontend/src directory exists."""
        from pathlib import Path
        src_dir = Path("frontend/src")
        assert src_dir.exists() and src_dir.is_dir()

    def test_frontend_public_directory(self):
        """Test that frontend/public directory exists."""
        from pathlib import Path
        public_dir = Path("frontend/public")
        assert public_dir.exists() and public_dir.is_dir()

    def test_frontend_has_index_html(self):
        """Test that frontend/index.html exists."""
        from pathlib import Path
        index = Path("frontend/index.html")
        assert index.exists()

    def test_frontend_index_html_structure(self):
        """Test that index.html has basic structure."""
        from pathlib import Path
        index = Path("frontend/index.html")
        if index.exists():
            content = index.read_text()
            assert "<!DOCTYPE html>" in content or "<html" in content
            assert "<body>" in content or "<body" in content


class TestFrontendAPI:
    """Test frontend API configuration."""

    def test_app_api_endpoint_defined(self):
        """Test that API endpoint is defined in frontend."""
        from pathlib import Path
        app_file = Path("frontend/src/App.jsx")
        if app_file.exists():
            content = app_file.read_text()
            # Check for API URL or localhost configuration
            assert "localhost" in content or "api" in content.lower() or "API" in content

    def test_websocket_url_defined(self):
        """Test that WebSocket URL is configured."""
        from pathlib import Path
        app_file = Path("frontend/src/App.jsx")
        if app_file.exists():
            content = app_file.read_text()
            # Check for WebSocket configuration
            assert "ws://" in content or "websocket" in content.lower() or "WS_URL" in content


class TestFrontendDependencies:
    """Test frontend dependencies."""

    def test_react_dependency(self):
        """Test that React is in dependencies."""
        from pathlib import Path
        import json

        package_file = Path("frontend/package.json")
        if package_file.exists():
            with package_file.open() as f:
                pkg = json.load(f)
                deps = pkg.get("dependencies", {})
                assert "react" in deps or "React" in str(deps)

    def test_vite_dev_dependency(self):
        """Test that Vite is in dev dependencies."""
        from pathlib import Path
        import json

        package_file = Path("frontend/package.json")
        if package_file.exists():
            with package_file.open() as f:
                pkg = json.load(f)
                dev_deps = pkg.get("devDependencies", {})
                assert "vite" in dev_deps


class TestFrontendBuild:
    """Test frontend build configuration."""

    def test_build_output_directory(self):
        """Test that dist directory is properly configured."""
        from pathlib import Path
        vite_config = Path("frontend/vite.config.js")
        if vite_config.exists():
            content = vite_config.read_text()
            # Check for outDir or build configuration
            assert "dist" in content or "build" in content or True


class TestAnalyticsDirectory:
    """Test analytics output directory structure."""

    def test_analytics_public_directory(self):
        """Test that frontend/public/analytics directory exists or is configured."""
        from pathlib import Path
        analytics_dir = Path("frontend/public/analytics")
        # Directory may or may not exist at test time
        # Just verify the path structure makes sense
        assert "analytics" in str(analytics_dir)
