
                                    fetch("dummy")
                                        .then(res => {
                                            if (!res.ok) throw new Error(res.statusText);
                                            return res.arrayBuffer();
                                        })
                                        .then(buffer => {
                                            const bytes = new Uint8Array(buffer);
                                            let binary = '';
                                            const len = bytes.byteLength;
                                            for (let i = 0; i < len; i += 32768) {
                                                binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
                                            }
                                            return btoa(binary);
                                        })
                                