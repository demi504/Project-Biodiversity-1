# Comprehensive Test Suite — UNIBEN Campus Biodiversity Pipeline

## Overview

This test suite provides comprehensive coverage for both **backend** (FastAPI/Python) and **frontend** (React/TypeScript) components of the UNIBEN biodiversity and environmental data pipeline.

## Project Structure

```
tests/
├── conftest.py                    # Shared fixtures and configuration
├── test_main.py                   # FastAPI endpoint tests
├── test_pipeline_analytics.py     # Data cleaning and analytics tests
├── test_report_engine.py          # Excel report generation tests
├── test_enrich_pipeline.py        # Taxonomic enrichment (PlantNet) tests
├── test_frontend.py               # Frontend configuration and structure tests
├── requirements-test.txt          # Test dependencies
└── __init__.py                    # Package marker
pytest.ini                         # Pytest configuration
```

## Test Coverage

### Backend Tests (`test_main.py`)
- **Health Checks**: `/health`, `/api/v1/hardware/status`
- **Sensor Readings**: Create, list, filter sensor data
- **Image Classification**: Upload drone/ground images, inference
- **Drone Uploads**: Patch and batch image uploads
- **SD Card Uploads**: CSV contingency data ingestion
- **Weather Integration**: OpenWeatherMap API integration
- **Analytics Pipeline**: Data processing pipeline execution
- **Reports**: Excel export and email sharing

### Analytics Tests (`test_pipeline_analytics.py`)
- DataCleaner outlier detection
- AnalyticsEngine initialization and scheduling
- Rolling statistics calculation
- Plot generation (Matplotlib/Seaborn)

### Report Engine Tests (`test_report_engine.py`)
- Excel spreadsheet generation (4 sheets)
- Colour palette and formatting
- Anomaly detection and flagging
- Darwin Core schema compliance

### Enrichment Pipeline Tests (`test_enrich_pipeline.py`)
- PlantNet API integration
- Image bytes processing
- Taxonomy normalization
- Error handling for API failures

### Frontend Tests (`test_frontend.py`)
- React component file structure
- Vite configuration validation
- TypeScript configuration
- Package.json dependency validation
- HTML structure validation

## Installation

### 1. Install Test Dependencies

```bash
# Using pip
pip install -r tests/requirements-test.txt

# Or install in dev environment
cd Environmental\ Biodiversity
pip install -r tests/requirements-test.txt
```

### 2. Activate Virtual Environment

```bash
# Windows PowerShell
.venv\Scripts\Activate.ps1

# Windows CMD
.venv\Scripts\activate.bat

# Linux/Mac
source .venv/bin/activate
```

## Running Tests

### Run All Tests
```bash
pytest
```

### Run Specific Test File
```bash
pytest tests/test_main.py
pytest tests/test_frontend.py
```

### Run Specific Test Class
```bash
pytest tests/test_main.py::TestSensorReadings
pytest tests/test_main.py::TestImageClassification
```

### Run Specific Test Function
```bash
pytest tests/test_main.py::TestSensorReadings::test_create_sensor_reading_success
```

### Run with Verbose Output
```bash
pytest -v
```

### Run with Coverage Report
```bash
pytest --cov=. --cov-report=html
# Open htmlcov/index.html in browser
```

### Run Only Backend Tests
```bash
pytest tests/ -m backend
```

### Run Only Frontend Tests
```bash
pytest tests/test_frontend.py
```

### Run Tests Matching Pattern
```bash
pytest -k "sensor" -v
pytest -k "image" -v
```

### Run with Markers
```bash
pytest -m "not slow"
pytest -m "unit"
```

## Test Fixtures

### Database Fixtures (`conftest.py`)
- `temp_dir`: Temporary directory for test files
- `temp_db_path`: Temporary SQLite database path
- `temp_upload_dir`: Upload directory for test files
- `temp_analytics_dir`: Analytics output directory
- `temp_exports_dir`: Report export directory
- `test_db`: Initialized SQLite database with schema
- `app_with_test_config`: FastAPI app with test configuration
- `client`: FastAPI TestClient

### Data Fixtures
- `sample_sensor_reading`: Valid sensor reading data
- `sample_invalid_sensor_reading`: Invalid sensor reading data
- `utc_now`: Current UTC datetime
- `mock_torch`: Mocked PyTorch module
- `mock_pillow_image`: Mocked PIL Image

## Test Examples

### Testing Sensor Reading Creation
```python
def test_create_sensor_reading(client, sample_sensor_reading):
    response = client.post("/sensor-readings", json=sample_sensor_reading)
    assert response.status_code == 201
    data = response.json()
    assert data["device_id"] == sample_sensor_reading["device_id"]
```

### Testing Image Upload
```python
def test_upload_image(client):
    image_data = b"\xFF\xD8\xFF\xE0\x00\x10JFIF"  # JPEG header
    response = client.post(
        "/api/v1/upload-image",
        files={"file": ("test.jpg", image_data, "image/jpeg")}
    )
    assert response.status_code == 200
```

### Testing with Mocks
```python
@patch("urllib.request.urlopen")
def test_weather_api(mock_urlopen, client):
    mock_response = MagicMock()
    mock_response.read.return_value = json.dumps({"main": {"temp": 25}}).encode()
    mock_urlopen.return_value.__enter__.return_value = mock_response
    
    response = client.get("/api/weather/field-day?latitude=6.335&longitude=5.603")
    assert response.status_code in (200, 400)
```

## Continuous Integration

### GitHub Actions Example
```yaml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-python@v4
        with:
          python-version: '3.10'
      - run: pip install -r tests/requirements-test.txt
      - run: pytest --cov=. --cov-report=xml
      - uses: codecov/codecov-action@v3
```

## Troubleshooting

### Import Errors
```bash
# Ensure backend modules are in Python path
export PYTHONPATH="${PYTHONPATH}:$(pwd)"
pytest
```

### Database Errors
```bash
# Tests create temporary databases - if cleanup fails:
rm -f tests/.tmp_*.db
pytest --tb=short
```

### Missing Dependencies
```bash
# Install all test dependencies
pip install pytest pytest-asyncio pytest-cov pytest-mock httpx
pip install pandas numpy openpyxl matplotlib seaborn
```

### WebSocket Tests
```bash
# WebSocket tests require running backend server
# In one terminal:
uvicorn main:app --reload

# In another terminal:
pytest tests/test_main.py::TestTelemetry -v
```

## Best Practices

### Writing New Tests
1. **Use descriptive names**: `test_create_sensor_reading_with_valid_data`
2. **Test one thing**: Each test should verify a single behavior
3. **Use fixtures**: Leverage pytest fixtures for setup/teardown
4. **Mock external calls**: Use `@patch` for API calls, file I/O
5. **Test error cases**: Include tests for invalid inputs and edge cases

### Test Organization
```python
class TestFeatureName:
    """Test description."""
    
    def test_success_case(self):
        """What should happen on success."""
        pass
    
    def test_invalid_input(self):
        """What should happen with invalid data."""
        pass
    
    def test_error_handling(self):
        """What should happen on errors."""
        pass
```

### Mocking Best Practices
```python
# Mock external APIs
@patch("requests.post")
def test_with_mock(mock_post):
    mock_post.return_value.json.return_value = {"key": "value"}
    # Test code here

# Use context managers for cleanup
with patch("os.environ") as mock_env:
    mock_env.get.return_value = "test_value"
    # Test code here
```

## Performance

- **Fast tests**: ~50ms per test on average
- **Total suite**: ~30-60 seconds for full run (depending on fixtures)
- **Parallel execution**: `pytest -n auto` with pytest-xdist

## Coverage Goals

- **Backend**: 70-80% coverage (focus on critical paths)
- **Frontend**: 50-60% coverage (structure and config validation)
- **Overall**: Aim for >60% coverage of codebase

## Maintenance

### Running Tests Locally Before Commit
```bash
# Run all tests and generate report
pytest --cov=. --cov-report=html -v

# Check coverage
open htmlcov/index.html  # macOS
xdg-open htmlcov/index.html  # Linux
start htmlcov/index.html  # Windows
```

### Adding New Tests
1. Create test function in appropriate `test_*.py` file
2. Use existing fixtures or create new ones in `conftest.py`
3. Run test: `pytest tests/test_file.py::TestClass::test_function -v`
4. Commit with message: `test: add tests for [feature]`

## Further Reading

- [Pytest Documentation](https://docs.pytest.org/)
- [FastAPI Testing](https://fastapi.tiangolo.com/advanced/testing-dependencies/)
- [Python unittest.mock](https://docs.python.org/3/library/unittest.mock.html)
- [React Testing Library](https://testing-library.com/react)

## Support

For test-related issues:
1. Check test output: `pytest -v --tb=long`
2. Review fixture setup in `conftest.py`
3. Ensure all dependencies are installed: `pip list | grep -E "pytest|httpx|fastapi"`
4. Check database initialization in `test_*.py`
