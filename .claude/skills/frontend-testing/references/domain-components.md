# Domain-Specific Component Testing

This guide covers testing patterns for ERP-specific domain components.

## Forecasting Components (`forecasts/`)

Forecasting components handle sales data visualization, logic execution, and bulk updates.

### Key Test Areas
1. **Sales History Display**: Verify that historical sales (M-1, M-2, M-3) render correctly.
2. **Forecast Calculations**: Verify that manual adjustments or formula-based overrides update the total.
3. **Bulk Actions**: Test selecting multiple products and triggering a batch forecast.

### Example: Forecast Table Row
```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import { ForecastRow } from './forecast-row'
import { createMockForecast } from '@/tests/factories'

describe('ForecastRow', () => {
  it('should display product name and previous month sales', () => {
    const forecast = createMockForecast({
      productName: 'Product A',
      history: { m1: 100, m2: 80, m3: 120 }
    })
    
    render(<ForecastRow data={forecast} />)
    
    expect(screen.getByText('Product A')).toBeInTheDocument()
    expect(screen.getByText('100')).toBeInTheDocument()
  })
})
```

## Inventory Components (`inventory/`)

Inventory components handle stock monitoring, location transfers, and stock card reporting.

### Key Test Areas
1. **Location Filtering**: Verify that selecting a warehouse updates the stock list.
2. **Stock Card Traceability**: Verify that clicking a document ID navigates to the source document.
3. **Zero Stock Visibility**: Ensure products with zero stock are displayed if the "Show All" filter is active.

### Example: Stock Filter Panel
```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import { StockFilters } from './stock-filters'

describe('StockFilters', () => {
  it('should trigger onWarehouseChange when a location is selected', () => {
    const handleChange = vi.fn()
    render(<StockFilters onWarehouseChange={handleChange} />)
    
    fireEvent.change(screen.getByRole('combobox', { name: /warehouse/i }), {
      target: { value: 'GFG-SBY' }
    })
    
    expect(handleChange).toHaveBeenCalledWith('GFG-SBY')
  })
})
```

## Configuration & Masters (`masters/`)

Master data components handle complex CRUD operations for products, categories, and users.

### Key Test Areas
1. **Deep Validation**: Test that SKU formats, unique names, and required fields are validated.
2. **Submission States**: Verify loading spinners and success toasts after saving.
3. **Cascading Deletes**: Verify confirmation dialogs appear before deleting a record with dependencies.
