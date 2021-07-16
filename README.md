# Uniswap V3 Position Tracker
A tool to extract historical Uniswap V3 positions data into a CSV

## Usage
1. Copy .env.default to .env
    ```
    cp .env.default .env
    ```

2. Replace GRAPH_API_KEY with your graph API key from https://thegraph.com/.  
    Note: the Uniswap V3 subgraph is free to use, but it seems making queries to it fail if you have no GRT in your Graph account. To get it to work, create an account and add a very small amount of GRT to it. You can do this through Polygon so the fees are nto to bad.

3. Install dependencies
    You will need to have Node.js, yarn, and ts-node installed on your computer. Once those are installed, run
    ```
    yarn
    ```
4. Run script
    ```
    ts-node index.ts <uniswap V3 NFT ID> <output file path>
    ```