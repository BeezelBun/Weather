# Weather

Met Office Weather DataHub webpage.

This is a clean Met Office-only starter. It does not use Open-Meteo.

## What it does

- Uses Met Office Weather DataHub Map Images API.
- Lets you paste a DataHub API key locally in the browser.
- Lists your active Map Images orders.
- Loads the latest PNG files for an order.
- Places the selected PNG over a simple UK map.
- Keeps the control pane collapsible so the map stays visible on iPhone.

## Important

Do not commit your API key into this repo.

The API key is entered in the webpage. It is only saved in your browser if you tick **remember on this device**.

## Met Office setup

In Weather DataHub, create or use a Map Images order for the UK domain and the weather parameter you want, for example:

- Precipitation rate
- Temperature at the surface
- Total cloud cover
- Pressure reduced to mean sea level

Then open this GitHub Pages site and press **List orders**.

## GitHub Pages

After adding these files:

1. Go to the repository settings.
2. Open **Pages**.
3. Choose **Deploy from a branch**.
4. Select `main` and `/root`.
5. Save.

The live page should then become:

`https://beezelbun.github.io/Weather/`

## Version

0.1.0
