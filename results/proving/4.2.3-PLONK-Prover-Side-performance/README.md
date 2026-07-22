# PLONK prover-side performance

This directory contains the published PLONK measurements collected on three
evaluation environments.

## Experimental configuration

- Merkle-tree depths: 5–15
- Selected leaf index: 0
- Reported measurements:
  - input generation
  - witness generation
  - proof generation
  - off-chain verification
  - total execution time
  - execution status

#### Published PLONK benchmark results

**Table — PLONK proving and verification time across Merkle tree depths on three environments (seconds).** For each `(depth, device)` configuration, values are summarized from repeated runs under the off-chain benchmarking protocol.

<table>
  <thead>
    <tr>
      <th rowspan="2">Depth</th>
      <th colspan="5">Device #1</th>
      <th colspan="5">Device #2</th>
      <th colspan="5">Device #3</th>
    </tr>
    <tr>
      <th>Input</th>
      <th>Witness</th>
      <th>Prove</th>
      <th>Verify</th>
      <th>Total</th>
      <th>Input</th>
      <th>Witness</th>
      <th>Prove</th>
      <th>Verify</th>
      <th>Total</th>
      <th>Input</th>
      <th>Witness</th>
      <th>Prove</th>
      <th>Verify</th>
      <th>Total</th>
    </tr>
  </thead>
  <tbody>
    <tr><td>5</td><td>0.048</td><td>0.059</td><td>17.961</td><td>0.350</td><td>18.419</td><td>0.048</td><td>0.070</td><td>24.502</td><td>0.782</td><td>25.402</td><td>0.245</td><td>0.272</td><td>51.748</td><td>1.301</td><td>53.567</td></tr>
    <tr><td>6</td><td>0.048</td><td>0.060</td><td>17.012</td><td>0.327</td><td>17.447</td><td>0.059</td><td>0.076</td><td>24.457</td><td>0.803</td><td>25.397</td><td>0.238</td><td>0.273</td><td>50.109</td><td>1.283</td><td>51.905</td></tr>
    <tr><td>7</td><td>0.221</td><td>0.126</td><td>17.923</td><td>0.328</td><td>18.601</td><td>0.052</td><td>0.072</td><td>24.152</td><td>0.803</td><td>25.081</td><td>0.240</td><td>0.270</td><td>49.958</td><td>1.281</td><td>51.750</td></tr>
    <tr><td>8</td><td>0.053</td><td>0.065</td><td>17.092</td><td>0.332</td><td>17.543</td><td>0.052</td><td>0.080</td><td>23.955</td><td>0.827</td><td>24.914</td><td>0.238</td><td>0.279</td><td>50.710</td><td>1.331</td><td>52.560</td></tr>
    <tr><td>9</td><td>0.051</td><td>0.066</td><td>17.036</td><td>0.320</td><td>17.474</td><td>0.051</td><td>0.073</td><td>23.606</td><td>0.773</td><td>24.503</td><td>0.238</td><td>0.275</td><td>50.752</td><td>1.338</td><td>52.606</td></tr>
    <tr><td>10</td><td>0.050</td><td>0.085</td><td>16.943</td><td>0.443</td><td>17.531</td><td>0.047</td><td>0.082</td><td>24.793</td><td>0.740</td><td>25.663</td><td>0.237</td><td>0.270</td><td>50.437</td><td>1.323</td><td>52.267</td></tr>
    <tr><td>11</td><td>0.053</td><td>0.060</td><td>33.417</td><td>0.335</td><td>33.865</td><td>0.046</td><td>0.072</td><td>46.516</td><td>0.803</td><td>47.437</td><td>0.239</td><td>0.271</td><td>98.949</td><td>1.288</td><td>100.748</td></tr>
    <tr><td>12</td><td>0.050</td><td>0.062</td><td>33.941</td><td>0.326</td><td>34.380</td><td>0.055</td><td>0.073</td><td>46.551</td><td>0.830</td><td>47.509</td><td>0.244</td><td>0.274</td><td>89.457</td><td>1.193</td><td>91.168</td></tr>
    <tr><td>13</td><td>0.051</td><td>0.064</td><td>32.565</td><td>0.352</td><td>33.033</td><td>0.049</td><td>0.076</td><td>47.624</td><td>0.770</td><td>48.520</td><td>0.219</td><td>0.247</td><td>100.421</td><td>1.294</td><td>102.182</td></tr>
    <tr><td>14</td><td>0.049</td><td>0.060</td><td>32.377</td><td>0.336</td><td>32.824</td><td>0.046</td><td>0.070</td><td>46.782</td><td>0.788</td><td>47.687</td><td>0.237</td><td>0.283</td><td>96.836</td><td>1.453</td><td>98.810</td></tr>
    <tr><td>15</td><td>0.050</td><td>0.061</td><td>32.824</td><td>0.333</td><td>33.269</td><td>0.052</td><td>0.078</td><td>47.494</td><td>0.755</td><td>48.380</td><td>0.246</td><td>0.286</td><td>97.541</td><td>1.205</td><td>99.279</td></tr>
  </tbody>
</table>

All PLONK benchmark executions completed successfully. The raw CSV files report input-generation time, witness-generation time, proving time, verification time, total execution time, and execution status.

| Artifact | Link |
|---|---|
| Device #1 PLONK measurements | [device1-plonk.csv](device1-plonk.csv) |
| Device #2 PLONK measurements | [device2-plonk.csv](device2-plonk.csv) |
| Device #3 PLONK measurements | [device3-plonk.csv](device3-plonk.csv) |
| PLONK benchmark visualization | [Figure 8 (PDF)](Figure_8.pdf) |
| Complete artifact directory | This directory |

---

## Reproduction

See the
[PLONK prover-side performance guide](../../../docs/experiments/experiment-2.3-plonk.md).
