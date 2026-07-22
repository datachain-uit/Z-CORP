# Groth16 prover-side performance

This directory contains the published Groth16 measurements collected on three
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

#### Published Groth16 benchmark results

**Table — Groth16 proving and verification time across Merkle tree depths on three environments (seconds).** For each `(depth, device)` configuration, values are summarized from repeated runs under the off-chain benchmarking protocol.

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
    <tr><td>5</td><td>0.051</td><td>0.056</td><td>0.476</td><td>0.362</td><td>0.945</td><td>0.048</td><td>0.069</td><td>1.062</td><td>0.776</td><td>1.956</td><td>0.247</td><td>0.276</td><td>1.889</td><td>1.387</td><td>3.801</td></tr>
    <tr><td>6</td><td>0.045</td><td>0.058</td><td>0.493</td><td>0.284</td><td>0.880</td><td>0.044</td><td>0.079</td><td>1.003</td><td>0.758</td><td>1.885</td><td>0.242</td><td>0.271</td><td>1.748</td><td>1.392</td><td>3.655</td></tr>
    <tr><td>7</td><td>0.046</td><td>0.059</td><td>0.507</td><td>0.287</td><td>0.899</td><td>0.046</td><td>0.076</td><td>1.042</td><td>0.791</td><td>1.955</td><td>0.238</td><td>0.269</td><td>1.868</td><td>1.281</td><td>3.658</td></tr>
    <tr><td>8</td><td>0.046</td><td>0.059</td><td>0.558</td><td>0.285</td><td>0.949</td><td>0.048</td><td>0.073</td><td>1.098</td><td>0.780</td><td>2.000</td><td>0.245</td><td>0.273</td><td>1.855</td><td>1.325</td><td>3.699</td></tr>
    <tr><td>9</td><td>0.048</td><td>0.061</td><td>0.566</td><td>0.289</td><td>0.966</td><td>0.050</td><td>0.081</td><td>1.073</td><td>0.772</td><td>1.977</td><td>0.236</td><td>0.269</td><td>1.801</td><td>1.314</td><td>3.622</td></tr>
    <tr><td>10</td><td>0.049</td><td>0.062</td><td>0.566</td><td>0.282</td><td>0.960</td><td>0.047</td><td>0.081</td><td>1.161</td><td>0.784</td><td>2.073</td><td>0.242</td><td>0.272</td><td>1.814</td><td>1.274</td><td>3.602</td></tr>
    <tr><td>11</td><td>0.097</td><td>0.059</td><td>0.588</td><td>0.281</td><td>1.027</td><td>0.054</td><td>0.075</td><td>1.112</td><td>0.758</td><td>1.999</td><td>0.247</td><td>0.269</td><td>1.858</td><td>1.288</td><td>3.663</td></tr>
    <tr><td>12</td><td>0.051</td><td>0.057</td><td>0.623</td><td>0.284</td><td>1.015</td><td>0.044</td><td>0.071</td><td>1.060</td><td>0.780</td><td>1.955</td><td>0.237</td><td>0.272</td><td>1.858</td><td>1.292</td><td>3.661</td></tr>
    <tr><td>13</td><td>0.049</td><td>0.060</td><td>0.623</td><td>0.283</td><td>1.015</td><td>0.047</td><td>0.074</td><td>1.025</td><td>0.760</td><td>1.908</td><td>0.236</td><td>0.276</td><td>1.855</td><td>1.292</td><td>3.659</td></tr>
    <tr><td>14</td><td>0.049</td><td>0.059</td><td>0.637</td><td>0.283</td><td>1.029</td><td>0.052</td><td>0.073</td><td>1.121</td><td>0.775</td><td>2.021</td><td>0.236</td><td>0.276</td><td>1.982</td><td>1.376</td><td>3.871</td></tr>
    <tr><td>15</td><td>0.048</td><td>0.057</td><td>0.651</td><td>0.289</td><td>1.045</td><td>0.046</td><td>0.074</td><td>1.114</td><td>0.798</td><td>2.033</td><td>0.240</td><td>0.269</td><td>1.914</td><td>1.308</td><td>3.732</td></tr>
  </tbody>
</table>

All Groth16 benchmark executions completed successfully. The raw CSV files report input-generation time, witness-generation time, proving time, verification time, total execution time, and execution status.

| Artifact | Link |
|---|---|
| Device #1 Groth16 measurements | [device1-groth16.csv](device1-groth16.csv) |
| Device #2 Groth16 measurements | [device2-groth16.csv](device2-groth16.csv) |
| Device #3 Groth16 measurements | [device3-groth16.csv](device3-groth16.csv) |
| Groth16 benchmark visualization | [Figure 7 (PDF)](Figure_7.pdf) |
| Complete artifact directory | This directory |

---

## Reproduction

See the
[Groth16 prover-side performance guide](../../../docs/experiments/experiment-3-groth16.md).
